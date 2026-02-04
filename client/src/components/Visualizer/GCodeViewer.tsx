import React, { useMemo } from 'react';
import * as THREE from 'three';

interface GCodeViewerProps {
    gcode: string[];
}

const GCodeViewer: React.FC<GCodeViewerProps> = ({ gcode }) => {
    const { moves, cuts } = useMemo(() => {
        const moves: THREE.Vector3[] = [];
        const cuts: THREE.Vector3[] = [];

        let cx = 0, cy = 0, cz = 0;
        let isCut = false;

        gcode.forEach(line => {
            const parts = line.toUpperCase().split(' ');
            let hasMove = false;

            if (line.includes('G0')) isCut = false;
            else if (line.includes('G1') || line.includes('G2') || line.includes('G3')) isCut = true;

            parts.forEach(p => {
                if (p.startsWith('X')) { cx = parseFloat(p.substring(1)); hasMove = true; }
                if (p.startsWith('Y')) { cy = parseFloat(p.substring(1)); hasMove = true; }
                if (p.startsWith('Z')) { cz = parseFloat(p.substring(1)); hasMove = true; }
            });

            if (hasMove) {
                const pt = new THREE.Vector3(cx, cy, cz);
                if (isCut) cuts.push(pt);
                else moves.push(pt);
            }
        });
        return { moves, cuts };
    }, [gcode]);

    // Compute dashed distances for moves
    const moveGeometry = useMemo(() => {
        if (moves.length === 0) return null;
        const geo = new THREE.BufferGeometry().setFromPoints(moves);
        // Need to calculate line distances for dashed material
        // But BufferGeometry.computeLineDistances doesn't work well on disconnected segments unless it's a LineSegments?
        // Since we are pushing points sequentially, it's a strip.
        // For proper dashing on a strip, simple .computeLineDistances() works (?)
        // Actually, G0 moves are discrete jumps usually? 
        // If we render as LINE_STRIP, it draws lines between G0 points. 
        // G0 A -> G0 B is a travel. 
        // But what if G0 A -> G1 B -> G0 C?
        // Our parsing splits them into two arrays "cuts" and "moves".
        // This effectively draws a line from Move1 to Move2 to Move3, skipping the Cuts in between?
        // THAT IS WRONG.
        // It should be a single list of segments with types?
        return null; // Re-implementing correctly below
    }, [moves]);

    // RE-IMPLEMENTATION: Segment-based Approach
    const segments = useMemo(() => {
        const segs: { start: THREE.Vector3, end: THREE.Vector3, type: 'G0' | 'G1' }[] = [];
        let cx = 0, cy = 0, cz = 0;
        let lastPos = new THREE.Vector3(0, 0, 0);

        gcode.forEach(line => {
            const parts = line.toUpperCase().split(' ');
            let hasMove = false;
            let type: 'G0' | 'G1' | null = null;

            if (line.includes('G0')) type = 'G0';
            else if (line.includes('G1') || line.includes('G2') || line.includes('G3')) type = 'G1';

            parts.forEach(p => {
                if (p.startsWith('X')) { cx = parseFloat(p.substring(1)); hasMove = true; }
                if (p.startsWith('Y')) { cy = parseFloat(p.substring(1)); hasMove = true; }
                if (p.startsWith('Z')) { cz = parseFloat(p.substring(1)); hasMove = true; }
            });

            if (hasMove) {
                const newPos = new THREE.Vector3(cx, cy, cz);
                if (type) {
                    segs.push({ start: lastPos.clone(), end: newPos.clone(), type });
                }
                lastPos.copy(newPos);
            }
        });
        return segs;
    }, [gcode]);

    // Separate geometries for G0 and G1
    const { g0Geo, g1Geo } = useMemo(() => {
        const g0Points: number[] = [];
        const g1Points: number[] = [];

        segments.forEach(s => {
            if (s.type === 'G0') {
                g0Points.push(s.start.x, s.start.y, s.start.z);
                g0Points.push(s.end.x, s.end.y, s.end.z);
            } else {
                g1Points.push(s.start.x, s.start.y, s.start.z);
                g1Points.push(s.end.x, s.end.y, s.end.z);
            }
        });

        const g0 = new THREE.BufferGeometry();
        g0.setAttribute('position', new THREE.Float32BufferAttribute(g0Points, 3));
        // Calculate distances for dash
        // Manually or via helper? Simple Euclidean dist accumulation?
        // For LineSegments, each pair is independent.
        // LineDashedMaterial needs 'lineDistance' attribute.
        // We can just create it.
        const distances: number[] = [];
        for (let i = 0; i < g0Points.length; i += 6) {
            const dx = g0Points[i + 3] - g0Points[i];
            const dy = g0Points[i + 4] - g0Points[i + 1];
            const dz = g0Points[i + 5] - g0Points[i + 2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            distances.push(0, dist);
        }
        g0.setAttribute('lineDistance', new THREE.Float32BufferAttribute(distances, 1));


        const g1 = new THREE.BufferGeometry();
        g1.setAttribute('position', new THREE.Float32BufferAttribute(g1Points, 3));

        return { g0Geo: g0, g1Geo: g1 };
    }, [segments]);

    if (!gcode || gcode.length === 0) return null;

    return (
        <group>
            {/* Cuts: Solid Red */}
            <lineSegments geometry={g1Geo}>
                <lineBasicMaterial color="#ff0044" linewidth={2} />
            </lineSegments>

            {/* Moves: Dashed Blue/Cyan */}
            <lineSegments geometry={g0Geo}>
                <lineDashedMaterial
                    color="#00ffff"
                    opacity={0.5}
                    transparent
                    dashSize={2}
                    gapSize={2}
                />
            </lineSegments>
        </group>
    );
};

export default GCodeViewer;
