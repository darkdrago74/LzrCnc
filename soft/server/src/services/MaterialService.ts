import fs from 'fs/promises';
import path from 'path';

export interface Material {
    id: string;
    name: string;
    type: 'cut' | 'engrave' | 'raster';
    thickness: number; // Material thickness in mm
    speed: number;
    power: number; // 0-100 or S-value
    passes: number;
    notes?: string;
}

export class MaterialService {
    private dbPath: string;
    private materials: Material[] = [];

    constructor(dataDir: string) {
        this.dbPath = path.join(dataDir, 'materials.json');
        this.load();
    }

    private async load() {
        try {
            const data = await fs.readFile(this.dbPath, 'utf-8');
            this.materials = JSON.parse(data);
        } catch (e) {
            // If file doesn't exist, start empty
            this.materials = [];
        }
    }

    private async save() {
        await fs.writeFile(this.dbPath, JSON.stringify(this.materials, null, 2));
    }

    getAll(): Material[] {
        return this.materials;
    }

    async add(material: Omit<Material, 'id'>): Promise<Material> {
        const newMat = { ...material, id: Date.now().toString() };
        this.materials.push(newMat);
        await this.save();
        return newMat;
    }

    async update(id: string, updates: Partial<Material>): Promise<Material | null> {
        const idx = this.materials.findIndex(m => m.id === id);
        if (idx === -1) return null;

        this.materials[idx] = { ...this.materials[idx], ...updates };
        await this.save();
        return this.materials[idx];
    }

    async delete(id: string): Promise<boolean> {
        const initialLen = this.materials.length;
        this.materials = this.materials.filter(m => m.id !== id);
        if (this.materials.length !== initialLen) {
            await this.save();
            return true;
        }
        return false;
    }
}
