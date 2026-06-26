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

export type ShapeType = 'rect' | 'circle' | 'ellipse' | 'polygon' | 'star';

export interface ParametricConfig {
    shape: ShapeType;
    width?: number;       // rect, ellipse
    height?: number;      // rect, ellipse
    radius?: number;      // circle, polygon
    rx?: number;          // rect rounded corners
    ry?: number;          // rect rounded corners
    sides?: number;       // polygon, star
    innerRadius?: number; // star
}

export interface SceneObject {
    id: string;
    name: string;
    type: 'file' | 'rect' | 'circle' | 'text' | 'stl' | 'gcode' | 'image' | 'ellipse' | 'polygon' | 'star';
    content: string; // SVG string, DXF string, or URL
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
    selected?: boolean;
    parametric?: ParametricConfig;
    gcodeOptions?: {
        offsetX: number;
        offsetY: number;
        feedrateScale: number;
        feedrateOverride?: number;
    };
}

// ── Path analysis types (Phase 1 – milling) ──────────────────────────────────

export type PathClassification =
    | 'circle'
    | 'ellipse'
    | 'rectangle'
    | 'polygon'
    | 'closed_curve'   // closed loop containing arcs/splines
    | 'open_curve';    // open path — tool always follows the middle line

export interface PathPoint { x: number; y: number; }

export type RawPrimitive =
    | { type: 'line';     x1: number; y1: number; x2: number; y2: number }
    | { type: 'arc';      cx: number; cy: number; radius: number; startAngle: number; endAngle: number }
    | { type: 'circle';   cx: number; cy: number; radius: number }
    | { type: 'polyline'; points: PathPoint[]; closed: boolean };

export interface DetectedPath {
    id: string;
    closed: boolean;
    classification: PathClassification;
    /** Discretized points — direct input for THREE.BufferGeometry */
    points: PathPoint[];
    bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
    rawPrimitives: RawPrimitive[];
}

/** A milling operation assigned to a set of detected paths */
export type CutSide = 'inside' | 'outside' | 'on';

export interface MillingOperation {
    id: string;
    label: string;
    pathIds: string[];
    cutSide: CutSide;
    /** Total depth below stock surface (positive mm) */
    depth: number;
    /** Depth increment per pass (positive mm) */
    depthPerPass: number;
    feedrate: number;
    plungeRate: number;
    spindleSpeed: number;
    /** Endmill diameter in mm — used for inside/outside offset calculation */
    toolDiameter: number;
    /** Retract height above stock surface (mm) */
    safeZ: number;
}

/** Computed offset polygon returned by the server after G-code generation */
export interface ToolpathPolygon {
    id: string;
    points: PathPoint[];
    cutSide: CutSide;
}
