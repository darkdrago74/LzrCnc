export type Unit = 'mm' | 'inch';

export interface BaseTool {
    id: string;
    name: string;
    units: Unit;
}

export interface LaserTool extends BaseTool {
    type: 'laser';
    spotSize: number; // Diameter of the laser beam
    powerMax?: number; // S-value for 100% power (e.g. 1000 or 255)
}

export interface CNCTool extends BaseTool {
    type: 'cnc';
    diameter: number; // Bit diameter
    cutDepth: number; // Max cut depth per pass
    stepOver?: number; // % of diameter
}

export type MachineTool = LaserTool | CNCTool;

// ... existing tools ...

export interface VectorOptions {
    tool: MachineTool;
    format: 'svg' | 'dxf' | 'bitmap'; // bitmap means tracing
    feedrate: number;
    cutHeight?: number;
    passes?: number;
    // Potrace Options
    turdSize?: number; // suppress speckles
    alphaMax?: number; // corner threshold
    optCurve?: boolean;
    threshold?: number; // Binarization threshold for tracing

    // Z-Height Control
    workingZ?: number;
    safeZ?: number;

    // Vector Pathing
    cutSide?: 'on' | 'inside' | 'outside';
    pocket?: boolean;
}

export interface RasterOptions {
    tool: LaserTool;
    width: number;
    height: number;
    dpi: number;
    feedrate: number;
    powerMin: number;
    powerMax: number;
    invert: boolean;
    overscan?: number;
    scanlineDirection?: 'horizontal' | 'vertical' | 'diagonal';
    mode: 'grayscale' | 'bw' | 'dither';
    dither?: boolean; // Legacy/flag convenience
    threshold?: number; // White clip threshold (0-255)

    // Z-Height Control
    workingZ?: number;
    safeZ?: number;
}
