export interface Position {
    x: number;
    y: number;
    z: number;
}

export interface JobStatus {
    state: 'idle' | 'running' | 'paused' | 'done' | 'stopped' | 'error';
    sent: number;
    acked: number;
    total: number;
    startedAt?: number;
    finishedAt?: number;
    error?: string;
    currentLine?: string;
}

export interface MachineStatus {
    state: 'Idle' | 'Run' | 'Hold' | 'Jog' | 'Alarm' | 'Door' | 'Check' | 'Home' | 'Sleep' | 'Disconnected' | 'Connecting';
    pos: Position;
    feedrate: number;
    spindle: number;
    logs: string[];
    job?: JobStatus;
    ports?: string; // e.g. "Pn:P"
    limits?: {
        x: { min: number, max: number };
        y: { min: number, max: number };
        z: { min: number, max: number };
    };
    macros?: string[];
    machineSettings?: MachineSettings;
    grblSettings?: Record<number, number>; // $30, $32, etc.
}

export interface AxisSettings {
    visible: boolean;
    min: number;
    max: number;
    offset: number;
    direction: number;
    reversed: boolean;
    homingPos?: 'min' | 'max'; // Where is the home switch?
    endstops: {
        hasMin: boolean;
        hasMax: boolean;
    };
}

export interface WorkbenchSettings {
    width: number;
    height: number;
    depth: number;
    origin: 'bottom-left' | 'top-left' | 'top-right' | 'bottom-right';
    showWorkbench: boolean;
}

export interface MachineSettings {
    workbench: WorkbenchSettings;
    axes: {
        x: AxisSettings;
        y: AxisSettings;
        z: AxisSettings;
    };
    macros: any[];
}

// CAM Types
export type Unit = 'mm' | 'inch';

export interface BaseTool {
    id: string;
    name: string;
    units: Unit;
}

export interface LaserTool extends BaseTool {
    type: 'laser';
    spotSize: number;
    powerMax?: number;
}

export interface CNCTool extends BaseTool {
    type: 'cnc';
    diameter: number;
    cutDepth: number;
    stepOver?: number;
}

export type MachineTool = LaserTool | CNCTool;

export interface VectorOptions {
    tool: MachineTool;
    format: 'svg' | 'dxf';
    feedrate: number;
    cutHeight?: number;
    passes?: number;
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
}

export type ShapeType = 'rect' | 'ellipse' | 'slot' | 'polygon' | 'star' | 'text';

/** Parameters of a drawn shape; the object's content is regenerated from them when edited (see utils/shapes.ts). */
export interface ParametricConfig {
    shape: ShapeType;
    width?: number;       // rect, ellipse, slot (mm)
    height?: number;      // rect, ellipse, slot (mm)
    radius?: number;      // rect corner radius (mm)
    sides?: number;       // polygon, star
    /** polygon/star: construction-circle Ø, or across-flats when sizeBy = 'flats' (mm) */
    diameter?: number;
    sizeBy?: 'circle' | 'flats';
    innerRadius?: number; // star inner radius, % of outer
    angle?: number;       // polygon/star rotation (deg)
    hole?: number;        // centre hole Ø (mm), 0 = none
    fill?: boolean;       // filled (engrave area) instead of outline
    text?: string;
    font?: string;
    bold?: boolean;
    textHeight?: number;  // mm, font size
    textMode?: 'raster' | 'vector';
}

export interface SceneObject {
    id: string;
    name: string;
    type: 'file' | 'rect' | 'circle' | 'text' | 'stl' | 'gcode' | 'image' | 'ellipse' | 'polygon' | 'star';
    content: string; // SVG string, DXF string, or URL
    /** Center of the object on the bed, machine mm */
    position: [number, number, number];
    /** Euler angles in DEGREES (only Z is used for 2D objects) */
    rotation: [number, number, number];
    scale: [number, number, number];
    /** Unscaled physical size in mm (width, height) */
    size?: [number, number];
    /** SVG user units are millimetres (DXF exports) instead of CSS px */
    svgUnitsMm?: boolean;
    /** Laser operation this object is assigned to (default: by object kind) */
    operationId?: string;
    selected?: boolean;
    parametric?: ParametricConfig;
    gcodeOptions?: {
        offsetX: number;
        offsetY: number;
        feedrateScale: number;
        feedrateOverride?: number;
    };
}
