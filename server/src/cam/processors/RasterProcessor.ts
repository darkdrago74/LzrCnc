import { CamProcessor, CamJob, CamOperation, ProcessingResult } from '../interfaces.js';
import { ImageProcessor } from '../ImageProcessor.js';
import { RasterOptions } from '../Tools.js';

export class RasterProcessor extends CamProcessor {
    private imageProcessor: ImageProcessor;

    constructor() {
        super();
        this.imageProcessor = new ImageProcessor();
    }

    async process(job: CamJob, operation: CamOperation): Promise<ProcessingResult> {
        // Merge global options with operation settings
        const options = { ...job.options, ...operation.settings } as RasterOptions;

        const { width, height, tool, powerMin, powerMax, invert, feedrate } = options;
        const toolDiameter = tool.type === 'laser' ? tool.spotSize : 0.1; // Default

        // Calculate resolution
        const pixelWidth = Math.ceil(width / toolDiameter);
        const pixelHeight = Math.ceil(height / toolDiameter);

        // 1. Process Image
        const { data, info } = await this.imageProcessor.processForRaster(
            job.sourceFilePath,
            pixelWidth,
            pixelHeight,
            options.dither || false,
            options.threshold || 255
        );

        // 2. Generate G-code
        const lines: string[] = [];
        lines.push(`; Raster Operation: ${operation.id}`);
        lines.push(`; Dither: ${options.dither}, Threshold: ${options.threshold}`);

        // Initial Z Moves
        if (options.safeZ !== undefined) lines.push(`G0 Z${options.safeZ.toFixed(3)}`);
        lines.push('G0 X0 Y0'); // Go to Origin first
        if (options.workingZ !== undefined) lines.push(`G0 Z${options.workingZ.toFixed(3)}`);

        const stepX = width / info.width;
        const stepY = height / info.height;
        const pRange = powerMax - powerMin;

        // Optimization Parameters
        const OVERSCAN_DIST = options.overscan || 2.0; // mm
        const WHITE_SKIP_THRESHOLD = 5.0; // mm, min distance to bother switching to G0

        for (let y = 0; y < info.height; y++) {
            const isEven = y % 2 === 0;
            // Bidirectional: Even lines Left->Right, Odd lines Right->Left
            const startX = isEven ? 0 : info.width - 1;
            const endX = isEven ? info.width : -1;
            const step = isEven ? 1 : -1;

            const yPos = (y * stepY).toFixed(3);

            // Find the first and last black pixel on this line to optimize travel
            // If line is empty, we can skip it or just do a generic pass?
            // Better: Scan line first to find bounds.
            let firstBlack = -1;
            let lastBlack = -1;

            // Scan dependent on direction to find "start" and "end" relative to motion
            // Actually, for consistency, let's find absolute min/max X of data
            let minX = -1;
            let maxX = -1;

            for (let bx = 0; bx < info.width; bx++) {
                const bIdx = y * info.width + bx;
                if (data[bIdx] < 255) { // Is marked (not white)
                    if (minX === -1) minX = bx;
                    maxX = bx;
                }
            }

            if (minX === -1) {
                // Empty line, simple skip or rapid? 
                // If we are rastering, we still likely need to move Y.
                // But we can skip X motion entirely.
                lines.push(`; Empty Line ${y}`);
                continue;
            }

            // Directional Logic
            const lineStartPixel = isEven ? minX : maxX;
            const lineEndPixel = isEven ? maxX : minX;

            // Calculate Physical coordinates
            const xPhysicalStart = (lineStartPixel * stepX);
            const xPhysicalEnd = (lineEndPixel * stepX);

            // 1. Move to Start (with Overscan)
            // If coming from previous line, we are at previous End. 
            // We want to accelerate INTO the start.
            // Overscan: Start movement Delta away.

            const approachX = xPhysicalStart - (step * OVERSCAN_DIST);

            lines.push(`G0 X${approachX.toFixed(3)} Y${yPos}`); // Rapid to overscan start
            lines.push(`G1 X${xPhysicalStart.toFixed(3)} S0 F${feedrate}`); // Lead-in

            let currentXPixel = lineStartPixel;

            // Process the "Active" part of the line
            while (currentXPixel !== lineEndPixel + step) { // Iterate until past the end
                // Run Length Encoding style optimization
                // Find run of constant color or gradient?
                // For Dithering (Binary), we frequently switch S0 / SMax.
                // For Grayscale, S changes constantly.

                const idx = y * info.width + currentXPixel;
                const intensity = data[idx];
                const power = (powerMin + ((255 - intensity) / 255) * pRange); // Invert: 0(Black) -> MaxPower
                const fixedPower = power.toFixed(1);

                // Look ahead to see if we have a long whitespace to skip
                // ONLY if not in dither mode (Dither mode usually has scattered dots, skipping is risky unless huge gap)
                // Actually, even in dither, if there is a massive gap, we should skip.

                let gapSize = 0;
                let peek = currentXPixel + step;
                while (peek !== lineEndPixel + step && data[y * info.width + peek] === 255) {
                    gapSize++;
                    peek += step;
                }

                const gapDist = gapSize * stepX;

                if (gapDist > WHITE_SKIP_THRESHOLD) {
                    // We hit a big white gap. 
                    // 1. Finish current pixel move
                    const targetX = ((currentXPixel + step) * stepX).toFixed(3);
                    if (intensity < 255) {
                        lines.push(`G1 X${targetX} S${fixedPower}`);
                    } else {
                        lines.push(`G1 X${targetX} S0`);
                    }

                    // 2. Rapid over gap
                    // Turn off laser
                    if (intensity < 255) lines.push('S0');

                    const newXPixel = peek;
                    const newXPos = (newXPixel * stepX).toFixed(3);
                    lines.push(`G0 X${newXPos}`);

                    currentXPixel = newXPixel;
                } else {
                    // Standard Move
                    const targetX = ((currentXPixel + step) * stepX).toFixed(3);
                    if (intensity === 255) {
                        lines.push(`G1 X${targetX} S0`);
                    } else {
                        lines.push(`G1 X${targetX} S${fixedPower}`);
                    }
                    currentXPixel += step;
                }
            }

            // Overscan Out
            const exitX = xPhysicalEnd + (step * OVERSCAN_DIST);
            lines.push(`G1 X${exitX.toFixed(3)} S0`);
        }

        lines.push('M5');
        if (options.safeZ !== undefined) lines.push(`G0 Z${options.safeZ.toFixed(3)}`);
        lines.push('G0 X0 Y0');

        return {
            gcode: lines.join('\n'),
            stats: { lines: lines.length, duration: 0 }
        };
    }
}
