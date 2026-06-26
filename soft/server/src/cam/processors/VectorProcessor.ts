import { CamProcessor, CamJob, CamOperation, ProcessingResult } from '../interfaces.js';
import { VectorOptions } from '../Tools.js';
import * as potrace from 'potrace';
import * as makerjs from 'makerjs';
import fs from 'fs';

export class VectorProcessor extends CamProcessor {

    async process(job: CamJob, operation: CamOperation): Promise<ProcessingResult> {
        const options = { ...job.options, ...operation.settings } as VectorOptions;

        // Check if we need to Trace (Raster Source) or Parse (Vector Source)
        const isRasterSource = job.sourceFilePath?.match(/\.(png|jpg|jpeg|bmp)$/i);
        const isDxfSource = job.sourceFilePath?.match(/\.(dxf)$/i);

        let rootModel: makerjs.IModel;

        if (isRasterSource) {
            rootModel = await this.traceImage(job.sourceFilePath, options);
        } else if (isDxfSource) {
            const content = await fs.promises.readFile(job.sourceFilePath, 'utf-8');
            rootModel = await this.parseDxf(content);
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

    private async parseDxf(dxfContent: string): Promise<makerjs.IModel> {
        let DxfParser: any;
        try {
            // Dynamic import for dxf-parser
            const module = await import('dxf-parser');
            DxfParser = module.default || module;
        } catch (e) {
            console.error("Failed to load dxf-parser", e);
            throw new Error("dxf-parser is required for DXF support");
        }

        const parser = new DxfParser();
        const rootModel: makerjs.IModel = { models: {} };

        try {
            const dxf = parser.parseSync(dxfContent);

            dxf.entities.forEach((entity: any, index: number) => {
                const id = `${entity.type.toLowerCase()}_${index}`;
                if (entity.type === 'LINE') {
                    rootModel.models![id] = new makerjs.models.ConnectTheDots(false, [
                        [entity.vertices[0].x, entity.vertices[0].y],
                        [entity.vertices[1].x, entity.vertices[1].y]
                    ]);
                } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                    const points = entity.vertices.map((v: any) => [v.x, v.y]);
                    rootModel.models![id] = new makerjs.models.ConnectTheDots(entity.shape || false, points);
                } else if (entity.type === 'CIRCLE') {
                    rootModel.models![id] = {
                        paths: {
                            circle: new makerjs.paths.Circle([entity.center.x, entity.center.y], entity.radius)
                        }
                    };
                } else if (entity.type === 'ARC') {
                    // DXF angles are already in degrees
                    const startDeg = entity.startAngle;
                    const endDeg = entity.endAngle;
                    rootModel.models![id] = {
                        paths: {
                            arc: new makerjs.paths.Arc([entity.center.x, entity.center.y], entity.radius, startDeg, endDeg)
                        }
                    };
                }
            });
        } catch (e) {
            console.error(e);
            throw new Error('Failed to parse DXF');
        }

        return rootModel;
    }

    private generateGcode(model: makerjs.IModel, options: VectorOptions): string {
        const commands: string[] = [];
        const { tool, feedrate } = options;
        const powerIdx = tool.type === 'laser' ? tool.powerMax : 1000;

        // Tool Offset Support (cutSide)
        let finalModel = model;
        if (tool.type === 'cnc' && options.cutSide && options.cutSide !== 'on') {
            const distance = (tool.diameter / 2) * (options.cutSide === 'outside' ? 1 : -1);
            try {
                // outline distance: positive expands, negative shrinks
                finalModel = makerjs.model.outline(model, distance);
            } catch (e) {
                console.warn("MakerJS outline failed, falling back to original model", e);
            }
        }

        commands.push('; Vector Operation');
        commands.push(`F${feedrate}`);

        // Z-Heights Computation (Multipass)
        const zHeights: number[] = [];
        if (tool.type === 'cnc' && options.workingZ !== undefined && options.cutHeight !== undefined) {
            let currentZ = options.workingZ;
            const targetZ = options.cutHeight;
            const step = Math.abs(tool.cutDepth) || 1;

            if (currentZ > targetZ) {
                while (currentZ > targetZ) {
                    currentZ -= step;
                    if (currentZ < targetZ) currentZ = targetZ;
                    zHeights.push(currentZ);
                }
            } else {
                zHeights.push(options.workingZ);
            }
        } else if (options.passes && options.passes > 1) {
            for (let i = 0; i < options.passes; i++) {
                zHeights.push(options.workingZ !== undefined ? options.workingZ : 0);
            }
        } else {
            zHeights.push(options.workingZ !== undefined ? options.workingZ : 0);
        }

        if (options.safeZ !== undefined) commands.push(`G0 Z${options.safeZ.toFixed(3)}`);

        // Convert the final model to an array of paths that we can iterate.
        const flatPaths: { path: makerjs.IPath, offset: makerjs.IPoint }[] = [];

        const extractPaths = (m: makerjs.IModel, offset = [0, 0] as makerjs.IPoint) => {
            if (m.paths) {
                for (const id in m.paths) {
                    if (m.paths[id]) flatPaths.push({ path: m.paths[id], offset });
                }
            }
            if (m.models) {
                for (const id in m.models) {
                    let newOffset = offset;
                    if (m.models[id].origin) {
                        newOffset = makerjs.point.add(offset, m.models[id].origin as makerjs.IPoint);
                    }
                    extractPaths(m.models[id], newOffset);
                }
            }
        };
        extractPaths(finalModel);

        // Turn on spindle
        if (tool.type === 'cnc') {
            commands.push('M3');
        }

        for (const passZ of zHeights) {
            commands.push(`; --- Pass Z: ${passZ.toFixed(3)} ---`);
            let currentPt: makerjs.IPoint | null = null;

            for (const item of flatPaths) {
                const { path, offset } = item;
                const origin = makerjs.point.add(path.origin, offset);

                let absStart: makerjs.IPoint = origin;
                let absEnd: makerjs.IPoint = origin;
                let gCodeLine = '';

                if (path.type === 'line') {
                    const line = path as makerjs.paths.Line;
                    absEnd = makerjs.point.add(line.end, offset);
                    gCodeLine = `G1 X${absEnd[0].toFixed(3)} Y${absEnd[1].toFixed(3)}`;
                } else if (path.type === 'circle') {
                    const circle = path as makerjs.paths.Circle;
                    const r = circle.radius;
                    absStart = [origin[0] + r, origin[1]];
                    absEnd = absStart;
                    gCodeLine = `G2 X${absStart[0].toFixed(3)} Y${absStart[1].toFixed(3)} I${(-r).toFixed(3)} J0`;
                } else if (path.type === 'arc') {
                    const arc = path as makerjs.paths.Arc;
                    // makerjs point.fromPolar uses angle in radians
                    const p1 = makerjs.point.fromPolar(arc.startAngle * Math.PI / 180, arc.radius);
                    const p2 = makerjs.point.fromPolar(arc.endAngle * Math.PI / 180, arc.radius);

                    absStart = makerjs.point.add(origin, p1);
                    absEnd = makerjs.point.add(origin, p2);

                    const I = (origin[0] - absStart[0]).toFixed(3);
                    const J = (origin[1] - absStart[1]).toFixed(3);
                    gCodeLine = `G3 X${absEnd[0].toFixed(3)} Y${absEnd[1].toFixed(3)} I${I} J${J}`;
                }

                const distToStart = currentPt ? makerjs.measure.pointDistance(currentPt, absStart) : Infinity;
                const threshold = 0.05; // 0.05mm tolerance for disjoint

                if (distToStart > threshold) {
                    if (tool.type === 'laser') commands.push('M5');
                    if (options.safeZ !== undefined) commands.push(`G0 Z${options.safeZ.toFixed(3)}`);

                    commands.push(`G0 X${absStart[0].toFixed(3)} Y${absStart[1].toFixed(3)}`);

                    const plungeF = tool.type === 'cnc' ? 100 : feedrate;
                    commands.push(`G1 Z${passZ.toFixed(3)} F${plungeF}`);

                    if (tool.type === 'laser') commands.push(`M3 S${powerIdx}`);
                    commands.push(`F${feedrate}`);
                }

                commands.push(gCodeLine);
                currentPt = absEnd;
            }
        }

        if (tool.type === 'cnc' || tool.type === 'laser') commands.push('M5');
        if (options.safeZ !== undefined) commands.push(`G0 Z${options.safeZ.toFixed(3)}`);
        commands.push('G0 X0 Y0');

        return commands.join('\n');
    }
}
