export interface MaterialPreset {
    id: string;
    name: string;
    thickness: number; // mm
    speed: number;     // mm/min
    power: number;     // 0-100%
    passes: number;
    description?: string;
}

const API_URL = 'http://localhost:3000/materials';

export interface MaterialPreset {
    id: string;
    name: string;
    thickness: number; // mm
    speed: number;     // mm/min
    power: number;     // 0-100%
    passes: number;
    description?: string;
    type?: 'cut' | 'engrave' | 'raster';
}

export const MaterialLibrary = {
    getAll: async (): Promise<MaterialPreset[]> => {
        try {
            const res = await fetch(API_URL);
            if (!res.ok) throw new Error('Failed to fetch materials');
            return await res.json();
        } catch (e) {
            console.error(e);
            return [];
        }
    },

    save: async (preset: Omit<MaterialPreset, 'id'>) => {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(preset)
        });
        if (!res.ok) throw new Error('Failed to save material');
        return await res.json();
    },

    update: async (preset: MaterialPreset) => {
        const res = await fetch(API_URL, {
            method: 'POST', // Backend uses POST for update if ID exists, or we could add PUT
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(preset)
        });
        if (!res.ok) throw new Error('Failed to update material');
    },

    delete: async (id: string) => {
        await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
    }
};

