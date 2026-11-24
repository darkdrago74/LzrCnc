export interface Position {
    x: number;
    y: number;
    z: number;
}

export interface MachineStatus {
    state: 'Idle' | 'Run' | 'Jog' | 'Hold' | 'Alarm' | 'Door' | 'Check' | 'Home' | 'Sleep' | 'Disconnected' | 'Connecting';
    pos: Position;
    feedrate: number;
    spindle: number;
    logs: string[];
    ports?: string;
    limits?: {
        x: { min: number, max: number };
        y: { min: number, max: number };
        z: { min: number, max: number };
    };
    macros?: string[];
    grblSettings?: Record<string, string | number>;
}

export interface ProbeOptions {
    axis: 'z';
    feedrate: number;
    dist: number; // Max probe distance (usually negative)
    plateThickness: number;
    retract: number;
}

export interface MachineInterface {
    connect(portPath: string, baudRate?: number): Promise<void>;
    disconnect(): Promise<void>;
    homing(): Promise<void>;
    jog(axis: 'x' | 'y' | 'z', dist: number, feedrate: number): Promise<void>;
    command(gcode: string): Promise<void>;
    probe(options: ProbeOptions): Promise<void>;
    uploadFile(gcode: string, filename: string): Promise<void>;
    getStatus(): MachineStatus;

    // ── Job streaming ────────────────────────────────────────────────
    /**
     * Bytes of controller input buffer the job runner may keep in flight
     * (GRBL character-counting: 127). 0 = strict send-and-wait-for-ack.
     */
    readonly streamBufferSize: number;
    /** Send one line; resolves when the controller acknowledges it, rejects on error. */
    streamLine(line: string): Promise<void>;
    /** Pause motion (GRBL '!'). */
    feedHold(): Promise<void>;
    /** Resume after feedHold (GRBL '~'). */
    cycleResume(): Promise<void>;
    /** Abort current motion and discard queued commands, then make the tool safe (laser/spindle off). */
    abortJob(): Promise<void>;
    /** Soft reset (GRBL Ctrl-X). */
    softReset(): Promise<void>;

    // Event listeners could be added here or handling via EventEmitter
    on(event: 'status', listener: (status: MachineStatus) => void): void;
    on(event: 'error', listener: (err: Error) => void): void;
    on(event: 'log', listener: (log: string) => void): void;
}
