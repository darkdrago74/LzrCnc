export interface BoundingBox {
    min: { x: number, y: number, z: number };
    max: { x: number, y: number, z: number };
}

export function parseGcodeBounds(gcode: string): BoundingBox {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    const lines = gcode.split('\n');

    // Simple state tracking
    let x = 0, y = 0, z = 0; // Assume start at 0? Or should we only track absolute moves (G90)?
    // Most CAM generates G90.

    lines.forEach(line => {
        const upper = line.toUpperCase();
        if (upper.includes('X')) {
            const match = upper.match(/X([\d.-]+)/);
            if (match) {
                x = parseFloat(match[1]);
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
            }
        }
        if (upper.includes('Y')) {
            const match = upper.match(/Y([\d.-]+)/);
            if (match) {
                y = parseFloat(match[1]);
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        if (upper.includes('Z')) {
            const match = upper.match(/Z([\d.-]+)/);
            if (match) {
                z = parseFloat(match[1]);
                if (z < minZ) minZ = z;
                if (z > maxZ) maxZ = z;
            }
        }
    });

    // Handle case where no moves found (avoid Infinity)
    if (minX === Infinity) { minX = 0; maxX = 0; }
    if (minY === Infinity) { minY = 0; maxY = 0; }
    if (minZ === Infinity) { minZ = 0; maxZ = 0; }

    return {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ }
    };
}
