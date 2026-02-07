import DxfParser from 'dxf-parser';
import { CncTool } from './ToolLibrary.js';
// @ts-ignore
import ClipperLib from 'js-clipper';
import fs from 'fs';
import makerjs from 'makerjs';
import Jimp from 'jimp';

export interface CncJob2D {
    id: string;
    filePath: string;
    fileContent?: string;
    fileType?: 'dxf' | 'svg' | 'raster';
    tool: CncTool;
    operation: 'profile_outside' | 'profile_inside' | 'pocket' | 'engrave' | 'raster_relief';
    cutDepth: number;
    stepDown: number;
    safeZ: number;
    feedRate: number;
    plungeRate: number;
    spindleRPM: number;
    tabsEnabled?: boolean;
    tabInterval?: number;
    tabWidth?: number;
    tabHeight?: number;
    autoCenter?: boolean;
    machineWidth?: number;
    machineHeight?: number;
    rasterWidth?: number;
    resolution?: number;
}

export class CncService {

    constructor() { }

    async generate2D(job: CncJob2D): Promise<string> {
        // --- Raster Heightmap/Relief Logic ---
        if (job.fileType === 'raster' || job.operation === 'raster_relief') {
            return this.generateHeightmap(job);
        }

        const SCALE = 1000;
        const paths: Array<Array<{ X: number, Y: number }>> = [];

        // 1. Parsing Logic
        let rawContent = job.fileContent;
        let isSvg = job.fileType === 'svg';

        if (!rawContent && job.filePath) {
            rawContent = fs.readFileSync(job.filePath, 'utf-8');
            if (job.filePath.toLowerCase().endsWith('.svg')) isSvg = true;
        }

        if (!rawContent) throw new Error("No Content provided");

        if (isSvg) {
            const model = makerjs.importer.fromSVG(rawContent);
            const chains = makerjs.model.findChains(model) as any[];
            chains.forEach(chain => {
                const keyPoints = makerjs.chain.toKeyPoints(chain, 1);
                const path: Array<{ X: number, Y: number }> = [];
                keyPoints.forEach((p: any) => { path.push({ X: p[0] * SCALE, Y: p[1] * SCALE }); });
                if (path.length > 2) paths.push(path);
            });
        } else {
            const parser = new DxfParser();
            let dxf;
            try { dxf = parser.parseSync(rawContent); } catch (e) { throw new Error("DXF Parse Error: " + e); }
            if (!dxf) throw new Error("Empty DXF");

            dxf.entities.forEach((entity: any) => {
                if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                    const path: Array<{ X: number, Y: number }> = [];
                    entity.vertices.forEach((v: any) => { path.push({ X: v.x * SCALE, Y: v.y * SCALE }); });
                    if (path.length > 2) paths.push(path);
                }
            });
        }

        if (paths.length === 0) throw new Error("No usable vector paths found.");

        // --- Auto Center Logic ---
        if (job.autoCenter) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            paths.forEach(path => {
                path.forEach(p => {
                    if (p.X < minX) minX = p.X;
                    if (p.Y < minY) minY = p.Y;
                    if (p.X > maxX) maxX = p.X;
                    if (p.Y > maxY) maxY = p.Y;
                });
            });

            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;

            const machineW = (job.machineWidth || 300) * SCALE;
            const machineH = (job.machineHeight || 300) * SCALE;

            const targetX = machineW / 2;
            const targetY = machineH / 2;

            const offsetX = targetX - centerX;
            const offsetY = targetY - centerY;

            paths.forEach(path => {
                path.forEach(p => {
                    p.X += offsetX;
                    p.Y += offsetY;
                });
            });
        }

        // 2. Operation Logic
        const toolRadius = (job.tool.diameter / 2) * SCALE;
        let finalPaths = paths;

        if (job.operation !== 'engrave') {
            const co = new ClipperLib.ClipperOffset();
            const offsetType = ClipperLib.EndType.etClosedPolygon;
            const joinType = ClipperLib.JoinType.jtRound;
            co.AddPaths(paths, joinType, offsetType);

            const solutions = new ClipperLib.Paths();
            let delta = 0;
            if (job.operation === 'profile_outside') delta = toolRadius;
            else if (job.operation === 'profile_inside') delta = -toolRadius;
            else if (job.operation === 'pocket') delta = -toolRadius;

            co.Execute(solutions, delta);
            finalPaths = solutions;
        }

        // 3. G-Code Generation
        const gcode: string[] = [];
        gcode.push(`%`, `(Job: ${job.operation})`, `(Tool: ${job.tool.name})`);
        gcode.push(`G21 G90 G17`, `G0 Z${job.safeZ}`);

        if (job.spindleRPM > 0) {
            gcode.push(`M3 S${job.spindleRPM}`, `G4 P1`);
        } else {
            gcode.push(`M0 (Manual Spindle Start)`, `G4 P1`);
        }

        const totalDepth = Math.abs(job.cutDepth);
        const stepDown = Math.abs(job.stepDown);
        const step = stepDown > 0 ? stepDown : totalDepth;

        const tabsEnabled = job.tabsEnabled && job.operation.startsWith('profile');
        const tabHeight = job.tabHeight || 1.0;
        const tabWidth = (job.tabWidth || 5.0) * SCALE;
        const tabInterval = (job.tabInterval || 50.0) * SCALE;

        let currentDepth = 0;

        while (currentDepth < totalDepth) {
            currentDepth += step;
            if (currentDepth > totalDepth) currentDepth = totalDepth;
            const zLevel = -currentDepth;
            const isTabLayer = tabsEnabled && (currentDepth > (totalDepth - tabHeight));
            const baseZ = isTabLayer ? -(totalDepth - tabHeight) : zLevel;

            gcode.push(`(Layer Z=${zLevel.toFixed(3)})`);

            finalPaths.forEach(path => {
                if (path.length === 0) return;
                const start = path[0];
                gcode.push(`G0 X${(start.X / SCALE).toFixed(3)} Y${(start.Y / SCALE).toFixed(3)}`);
                gcode.push(`G1 Z${zLevel.toFixed(3)} F${job.plungeRate}`);

                let distTraveled = 0;
                let nextTabAt = tabInterval;

                for (let i = 1; i < path.length; i++) {
                    const p1 = path[i - 1];
                    const p2 = path[i];
                    const dx = p2.X - p1.X;
                    const dy = p2.Y - p1.Y;
                    const segLen = Math.sqrt(dx * dx + dy * dy);

                    if (isTabLayer && (distTraveled + segLen) > nextTabAt) {
                        const remainingToTab = nextTabAt - distTraveled;
                        const ratio = remainingToTab / segLen;
                        const tabStartX = p1.X + dx * ratio;
                        const tabStartY = p1.Y + dy * ratio;

                        gcode.push(`G1 X${(tabStartX / SCALE).toFixed(3)} Y${(tabStartY / SCALE).toFixed(3)} F${job.feedRate}`);
                        gcode.push(`G1 Z${baseZ.toFixed(3)} F${job.plungeRate}`); // Lift

                        const tabRatio = tabWidth / segLen;
                        const tabEndX = tabStartX + dx * tabRatio;
                        const tabEndY = tabStartY + dy * tabRatio;

                        gcode.push(`G1 X${(tabEndX / SCALE).toFixed(3)} Y${(tabEndY / SCALE).toFixed(3)} F${job.feedRate}`);
                        gcode.push(`G1 Z${zLevel.toFixed(3)} F${job.plungeRate}`); // Plunge

                        distTraveled += (remainingToTab + tabWidth);
                        nextTabAt += tabInterval;
                        gcode.push(`G1 X${(p2.X / SCALE).toFixed(3)} Y${(p2.Y / SCALE).toFixed(3)} F${job.feedRate}`);
                        distTraveled += (segLen - remainingToTab - tabWidth);
                    } else {
                        gcode.push(`G1 X${(p2.X / SCALE).toFixed(3)} Y${(p2.Y / SCALE).toFixed(3)} F${job.feedRate}`);
                        distTraveled += segLen;
                    }
                }

                if (job.operation !== 'engrave' || (path.length > 2 && path[0].X === path[path.length - 1].X && path[0].Y === path[path.length - 1].Y)) {
                    gcode.push(`G1 X${(start.X / SCALE).toFixed(3)} Y${(start.Y / SCALE).toFixed(3)} F${job.feedRate}`);
                }
                gcode.push(`G0 Z${job.safeZ}`);
            });
        }
        gcode.push(`M5`, `G0 Z${job.safeZ}`, `G0 X0 Y0`, `%`);
        return gcode.join('\n');
    }

    private async generateHeightmap(job: CncJob2D): Promise<string> {
        let buffer: Buffer;

        if (job.fileContent && job.fileContent.startsWith('data:')) {
            const base64Data = job.fileContent.replace(/^data:image\/\w+;base64,/, "");
            buffer = Buffer.from(base64Data, 'base64');
        } else if (job.filePath) {
            buffer = fs.readFileSync(job.filePath);
        } else {
            throw new Error("No image content provided");
        }

        const image = await Jimp.read(buffer);

        const targetWidthMm = job.rasterWidth || 100;
        const toolDiameter = job.tool.diameter;
        const stepover = job.resolution || (toolDiameter * 0.4);

        const aspectRatio = image.bitmap.height / image.bitmap.width;
        const targetHeightMm = targetWidthMm * aspectRatio;

        const pixelW = Math.floor(targetWidthMm / stepover);
        const pixelH = Math.floor(targetHeightMm / stepover);

        image.resize(pixelW, pixelH);

        const grayscale = image.grayscale();

        const gcode: string[] = [];
        gcode.push(`%`, `(Job: Raster Relief)`, `(Tool: ${job.tool.name})`);
        gcode.push(`G21 G90 G17`, `G0 Z${job.safeZ}`);
        if (job.spindleRPM > 0) gcode.push(`M3 S${job.spindleRPM}`); else gcode.push(`M0`);
        gcode.push(`G4 P1`);

        let offX = 0;
        let offY = 0;
        if (job.autoCenter) {
            const machineW = job.machineWidth || 300;
            const machineH = job.machineHeight || 300;
            offX = (machineW - targetWidthMm) / 2;
            offY = (machineH - targetHeightMm) / 2;
        }

        const maxDepth = Math.abs(job.cutDepth);

        for (let y = 0; y < pixelH; y++) {
            const isEven = y % 2 === 0;
            const startX = isEven ? 0 : pixelW - 1;
            const endX = isEven ? pixelW : -1;
            const stepX = isEven ? 1 : -1;

            for (let x = startX; x !== endX; x += stepX) {
                const color = grayscale.getPixelColor(x, pixelH - 1 - y);
                const rgb = Jimp.intToRGBA(color);
                const brightness = rgb.r / 255.0;
                const zDepth = -(maxDepth * (1 - brightness));

                const physicalX = offX + (x * stepover);
                const physicalY = offY + (y * stepover);

                gcode.push(`G1 X${physicalX.toFixed(3)} Y${physicalY.toFixed(3)} Z${zDepth.toFixed(3)} F${job.feedRate}`);
            }
        }
        gcode.push(`M5`, `G0 Z${job.safeZ}`, `G0 X0 Y0`, `%`);
        return gcode.join('\n');
    }
}
