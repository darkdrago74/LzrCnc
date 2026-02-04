import fs from 'fs';
import path from 'path';

export interface CncTool {
    id: string;
    name: string;
    type: 'endmill' | 'ballnose' | 'vbit' | 'drill';
    diameter: number; // mm
    flutes: number;
    material: 'hss' | 'carbide';
    maxRPM?: number;
    description?: string;
}

const DEFAULT_TOOLS: CncTool[] = [
    { id: 't1', name: '1/8" Endmill', type: 'endmill', diameter: 3.175, flutes: 2, material: 'carbide' },
    { id: 't2', name: '1/4" Endmill', type: 'endmill', diameter: 6.35, flutes: 2, material: 'carbide' },
    { id: 't3', name: '6mm Ballnose', type: 'ballnose', diameter: 6.0, flutes: 2, material: 'carbide' },
];

export class ToolLibrary {
    private storagePath: string;
    private tools: CncTool[] = [];

    constructor(storageDir: string = './data') {
        this.storagePath = path.join(storageDir, 'cnc_tools.json');
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        this.load();
    }

    private load() {
        if (fs.existsSync(this.storagePath)) {
            try {
                const data = fs.readFileSync(this.storagePath, 'utf-8');
                this.tools = JSON.parse(data);
            } catch (e) {
                console.error('Failed to load tool library', e);
                this.tools = [...DEFAULT_TOOLS];
            }
        } else {
            this.tools = [...DEFAULT_TOOLS];
            this.save();
        }
    }

    private save() {
        fs.writeFileSync(this.storagePath, JSON.stringify(this.tools, null, 2));
    }

    getAll(): CncTool[] {
        return this.tools;
    }

    getById(id: string): CncTool | undefined {
        return this.tools.find(t => t.id === id);
    }

    add(tool: Omit<CncTool, 'id'>): CncTool {
        const newTool = { ...tool, id: 'tool-' + Date.now() };
        this.tools.push(newTool);
        this.save();
        return newTool;
    }

    update(id: string, updates: Partial<CncTool>): CncTool | null {
        const idx = this.tools.findIndex(t => t.id === id);
        if (idx === -1) return null;

        this.tools[idx] = { ...this.tools[idx], ...updates };
        this.save();
        return this.tools[idx];
    }

    delete(id: string): boolean {
        const initialLen = this.tools.length;
        this.tools = this.tools.filter(t => t.id !== id);
        if (this.tools.length !== initialLen) {
            this.save();
            return true;
        }
        return false;
    }
}
