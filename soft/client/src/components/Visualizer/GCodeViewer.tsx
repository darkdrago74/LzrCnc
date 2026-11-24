import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { parseGcode } from '../../utils/gcodeParser';

interface GCodeViewerProps {
    gcode: string[];
    /** Index of the last G-code line already executed (job progress); those cuts are dimmed. */
    progressLine?: number;
    /** Added to every Z (milling: G-code Z0 is the stock top, so pass the stock thickness). */
    zOffset?: number;
    /** Colour cuts by laser power (S) or by depth below the stock top (milling). */
    colorBy?: 'power' | 'depth';
    /** G-code Z of the stock top, used for depth colouring (0 when Z0 = top, thickness when Z0 = bottom). */
    depthTop?: number;
    /** When false the toolpath is drawn but hidden (e.g. while the material simulation is shown). */
    visible?: boolean;
}

const CUT_LOW = new THREE.Color('#fbbf24');
const CUT_HIGH = new THREE.Color('#ef4444');
const DONE = new THREE.Color('#10b981');

const GCodeViewer: React.FC<GCodeViewerProps> = ({ gcode, progressLine = -1, zOffset = 0, colorBy = 'power', depthTop = 0, visible = true }) => {
    const parsed = useMemo(() => parseGcode(gcode), [gcode]);

    const { cutGeo, rapidGeo, cutLines, cutPower, maxS } = useMemo(() => {
        const cutPos: number[] = [];
        const rapidPos: number[] = [];
        const rapidDist: number[] = [];
        const cutLines: number[] = [];
        const cutPower: number[] = [];
        let maxS = 0;
        const weight = (s: (typeof parsed.segments)[number]) => colorBy === 'depth' ? Math.max(0, depthTop - Math.min(s.from[2], s.to[2])) : s.s;
        for (const s of parsed.segments) if (s.kind === 'cut' && weight(s) > maxS) maxS = weight(s);
        for (const s of parsed.segments) {
            if (s.kind === 'cut') {
                cutPos.push(...s.from, ...s.to);
                cutLines.push(s.line);
                cutPower.push(weight(s));
            } else {
                rapidPos.push(...s.from, ...s.to);
                rapidDist.push(0, Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1], s.to[2] - s.from[2]));
            }
        }
        const cutGeo = new THREE.BufferGeometry();
        cutGeo.setAttribute('position', new THREE.Float32BufferAttribute(cutPos, 3));
        cutGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(cutPos.length), 3));
        const rapidGeo = new THREE.BufferGeometry();
        rapidGeo.setAttribute('position', new THREE.Float32BufferAttribute(rapidPos, 3));
        rapidGeo.setAttribute('lineDistance', new THREE.Float32BufferAttribute(rapidDist, 1));
        return { cutGeo, rapidGeo, cutLines, cutPower, maxS };
    }, [parsed, colorBy, depthTop]);

    useEffect(() => {
        const attr = cutGeo.getAttribute('color') as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        const c = new THREE.Color();
        for (let i = 0; i < cutLines.length; i++) {
            if (cutLines[i] <= progressLine) c.copy(DONE);
            else c.copy(CUT_LOW).lerp(CUT_HIGH, maxS > 0 ? cutPower[i] / maxS : 1);
            arr.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
        }
        attr.needsUpdate = true;
    }, [cutGeo, cutLines, cutPower, maxS, progressLine]);

    useEffect(() => () => { cutGeo.dispose(); rapidGeo.dispose(); }, [cutGeo, rapidGeo]);

    if (!gcode || gcode.length === 0) return null;

    return (
        // Slightly above the bed surface to avoid z-fighting with the grid
        <group position={[0, 0, zOffset + 0.15]} visible={visible}>
            <lineSegments geometry={cutGeo}>
                <lineBasicMaterial vertexColors toneMapped={false} />
            </lineSegments>
            <lineSegments geometry={rapidGeo}>
                <lineDashedMaterial color="#0ea5e9" transparent opacity={0.55} dashSize={2} gapSize={2} />
            </lineSegments>
        </group>
    );
};

export default GCodeViewer;
