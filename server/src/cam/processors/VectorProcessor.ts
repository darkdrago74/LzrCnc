import { CamProcessor, CamJob, CamOperation, ProcessingResult } from '../interfaces.js';
import { VectorOptions } from '../Tools.js';
import potrace from 'potrace';
import * as makerjs from 'makerjs';
import fs from 'fs';

export class VectorProcessor extends CamProcessor {

    async process(job: CamJob, operation: CamOperation): Promise<ProcessingResult> {
        const options = { ...job.options, ...operation.settings } as VectorOptions;

        // Check if we need to Trace (Raster Source) or Parse (Vector Source)
        const isRasterSource = job.sourceFilePath.match(/\.(png|jpg|jpeg|bmp)$/i);

        let rootModel: makerjs.IModel;

        if (isRasterSource) {
            rootModel = await this.traceImage(job.sourceFilePath, options);
        } else {
            // Assume SVG
            const content = await fs.promises.readFile(job.sourceFilePath, 'utf-8');
            rootModel = await this.parseSvg(content);
        }

        const gcode = this.generateGcode(rootModel, options);

        return {
            gcode,
            stats: { lines: gcode.split('\n').length, duration: 0 }
        };
    }

    private async traceImage(filePath: string, options: VectorOptions): Promise<makerjs.IModel> {
        // Build potrace options
        const traceOptions = {
            threshold: options.threshold || 128,
            turnPolicy: 'black' as const, // potrace uses specific strings
            turdSize: options.turdSize || 2,
            optCurve: true,
            alphaMax: 1,
            optTolerance: 0.2
        };

        // Manually wrap potrace.trace to avoid promisify signature issues
        const svgContent = await new Promise<string>((resolve, reject) => {
            potrace.trace(filePath, traceOptions, (err, svg) => {
                if (err) reject(err);
                else resolve(svg);
            });
        });

        return this.parseSvg(svgContent);
    }

    private async parseSvg(svgContent: string): Promise<makerjs.IModel> {
        const xml2js = await import('xml2js');
        const parser = new xml2js.Parser();
        const rootModel: makerjs.IModel = { models: {} };

        try {
            const result = await parser.parseStringPromise(svgContent);
            const traverse = (obj: any) => {
                if (obj.path) {
                    obj.path.forEach((p: any, index: number) => {
                        if (p.$ && p.$.d) {
                            const pathModel = makerjs.importer.fromSVGPathData(p.$.d);
                            if (rootModel.models) {
                                rootModel.models[`path_${index}_${Math.random()}`] = pathModel;
                            }
                        }
                    });
                }
                if (obj.g) {
                    obj.g.forEach((g: any) => traverse(g));
                }
                if (obj.svg) traverse(obj.svg);
            };

            if (result.svg) {
                traverse(result.svg);
            }
        } catch (e) {
            console.error(e);
            throw new Error('Failed to parse SVG');
        }

        return rootModel;
    }

    private generateGcode(model: makerjs.IModel, options: VectorOptions): string {
        const commands: string[] = [];
        const { tool, feedrate } = options;
        const powerIdx = tool.type === 'laser' ? tool.powerMax : 1000;

        commands.push('; Vector Operation');
        commands.push(`F${feedrate}`);

        const walk = (m: makerjs.IModel, offset = { x: 0, y: 0 }) => {
            if (m.paths) {
                for (const id in m.paths) {
                    const path = m.paths[id];
                    if (!path) continue;
                    const origin = makerjs.point.add(path.origin, [offset.x, offset.y]);

                    const startPoint = origin;

                    if (path.type === 'line') {
                        commands.push(`G0 X${startPoint[0].toFixed(3)} Y${startPoint[1].toFixed(3)}`);
                        if (tool.type === 'laser') commands.push(`M3 S${powerIdx}`);
                        const line = path as makerjs.paths.Line;
                        const end = makerjs.point.add(line.end, [offset.x, offset.y]);
                        commands.push(`G1 X${end[0].toFixed(3)} Y${end[1].toFixed(3)}`);
                        if (tool.type === 'laser') commands.push('M5');
                    } else if (path.type === 'circle') {
                        const circle = path as makerjs.paths.Circle;
                        const r = circle.radius;
                        const center = startPoint;
                        const startX = center[0] + r;
                        const startY = center[1];

                        commands.push(`G0 X${startX.toFixed(3)} Y${startY.toFixed(3)}`);
                        if (tool.type === 'laser') commands.push(`M3 S${powerIdx}`);
                        commands.push(`G2 I${(-r).toFixed(3)} J0`);
                        if (tool.type === 'laser') commands.push('M5');
                    } else if (path.type === 'arc') {
                        const arc = path as makerjs.paths.Arc;
                        const center = startPoint;
                        const p1 = makerjs.point.fromPolar(arc.startAngle, arc.radius);
                        const p2 = makerjs.point.fromPolar(arc.endAngle, arc.radius);

                        const absStart = makerjs.point.add(center, p1);
                        const absEnd = makerjs.point.add(center, p2);

                        commands.push(`G0 X${absStart[0].toFixed(3)} Y${absStart[1].toFixed(3)}`);
                        if (tool.type === 'laser') commands.push(`M3 S${powerIdx}`);

                        const I = (center[0] - absStart[0]).toFixed(3);
                        const J = (center[1] - absStart[1]).toFixed(3);

                        commands.push(`G3 X${absEnd[0].toFixed(3)} Y${absEnd[1].toFixed(3)} I${I} J${J}`);
                        if (tool.type === 'laser') commands.push('M5');
                    }
                }
            }
            if (m.models) {
                for (const id in m.models) {
                    walk(m.models[id], offset);
                }
            }
        };

        walk(model);
        commands.push('G0 X0 Y0');
        return commands.join('\n');
    }
}
