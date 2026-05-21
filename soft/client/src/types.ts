export interface Position {
    x: number;
    y: number;
    z: number;
}

export interface MachineStatus {
    state: 'Idle' | 'Run' | 'Hold' | 'Alarm' | 'Door' | 'Check' | 'Home' | 'Sleep' | 'Disconnected' | 'Connecting';
    pos: Position;
    feedrate: number;
    spindle: number;
    logs: string[];
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

export interface SceneObject {
    id: string;
    name: string;
    type: 'file' | 'rect' | 'circle' | 'text' | 'stl' | 'gcode' | 'image';
    content: string; // SVG string, DXF string, or URL
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
    selected?: boolean;
    gcodeOptions?: {
        offsetX: number;
        offsetY: number;
        feedrateScale: number;
        feedrateOverride?: number;
    };
}
