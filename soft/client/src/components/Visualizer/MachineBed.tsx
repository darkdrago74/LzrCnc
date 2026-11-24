import React, { useMemo } from 'react';
import * as THREE from 'three';
import Label3D from './Label3D';
import type { BedExtents } from '../../utils/machineGeometry';

interface MachineBedProps {
    bed: BedExtents;
    visible?: boolean;
    showEnvelope?: boolean;
}

const BED_THICKNESS = 4;

/** Builds an XY grid (z = const) as line segments, snapped to absolute multiples of `step`. */
function gridGeometry(bed: BedExtents, step: number, z: number) {
    const pts: number[] = [];
    const x0 = Math.ceil(bed.minX / step) * step;
    const y0 = Math.ceil(bed.minY / step) * step;
    for (let x = x0; x <= bed.maxX + 1e-6; x += step) pts.push(x, bed.minY, z, x, bed.maxY, z);
    for (let y = y0; y <= bed.maxY + 1e-6; y += step) pts.push(bed.minX, y, z, bed.maxX, y, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
}

/** Arrow along +axis with a label; the scene is native Z-up so these are true machine axes. */
const AxisArrow: React.FC<{ dir: [number, number, number]; color: string; label: string; length: number }> = ({ dir, color, label, length }) => {
    const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir)), [dir]);
    const head = length * 0.22;
    const shaft = length - head;
    return (
        <group quaternion={quat}>
            <mesh position={[0, shaft / 2, 0]}>
                <cylinderGeometry args={[0.7, 0.7, shaft, 12]} />
                <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
            <mesh position={[0, shaft + head / 2, 0]}>
                <coneGeometry args={[2.2, head, 16]} />
                <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
            <Label3D text={label} position={[0, length + 6, 0]} color={color} size={7} />
        </group>
    );
};

export const OriginTriad: React.FC<{ length?: number }> = ({ length = 35 }) => (
    <group>
        <AxisArrow dir={[1, 0, 0]} color="#ef4444" label="X" length={length} />
        <AxisArrow dir={[0, 1, 0]} color="#22c55e" label="Y" length={length} />
        <AxisArrow dir={[0, 0, 1]} color="#3b82f6" label="Z" length={length} />
        <mesh>
            <sphereGeometry args={[1.6, 16, 16]} />
            <meshBasicMaterial color="#f8fafc" />
        </mesh>
    </group>
);

const MachineBed: React.FC<MachineBedProps> = ({ bed, visible = true, showEnvelope = true }) => {
    const minor = useMemo(() => gridGeometry(bed, 10, 0.02), [bed]);
    const major = useMemo(() => gridGeometry(bed, 50, 0.04), [bed]);
    const outline = useMemo(() => {
        const g = new THREE.BufferGeometry();
        const { minX: a, maxX: b, minY: c, maxY: d } = bed;
        g.setAttribute('position', new THREE.Float32BufferAttribute([a, c, 0.06, b, c, 0.06, b, d, 0.06, a, d, 0.06], 3));
        return g;
    }, [bed]);
    const envelope = useMemo(
        () => new THREE.EdgesGeometry(new THREE.BoxGeometry(bed.width, bed.height, bed.depth)),
        [bed.width, bed.height, bed.depth]
    );

    const ticks = useMemo(() => {
        const step = Math.max(bed.width, bed.height) > 600 ? 100 : 50;
        const xs: number[] = [];
        const ys: number[] = [];
        for (let x = Math.ceil(bed.minX / step) * step; x <= bed.maxX + 1e-6; x += step) if (x !== 0) xs.push(x);
        for (let y = Math.ceil(bed.minY / step) * step; y <= bed.maxY + 1e-6; y += step) if (y !== 0) ys.push(y);
        return { xs, ys };
    }, [bed]);

    // Rulers sit on the edges that touch the origin so the numbers read from (0,0).
    const rulerY = bed.minY === 0 ? bed.minY - 7 : bed.maxY + 7;
    const rulerX = bed.minX === 0 ? bed.minX - 9 : bed.maxX + 9;

    return (
        <group>
            {visible && (
                <>
                    <mesh position={[bed.centerX, bed.centerY, -BED_THICKNESS / 2]} receiveShadow>
                        <boxGeometry args={[bed.width, bed.height, BED_THICKNESS]} />
                        <meshStandardMaterial color="#d9dee5" roughness={0.85} metalness={0.05} />
                    </mesh>
                    <lineSegments geometry={minor}>
                        <lineBasicMaterial color="#b9c2ce" />
                    </lineSegments>
                    <lineSegments geometry={major}>
                        <lineBasicMaterial color="#8794a6" />
                    </lineSegments>
                    <lineLoop geometry={outline}>
                        <lineBasicMaterial color="#0891b2" />
                    </lineLoop>
                    {showEnvelope && (
                        <lineSegments geometry={envelope} position={[bed.centerX, bed.centerY, bed.depth / 2]}>
                            <lineBasicMaterial color="#334155" transparent opacity={0.6} />
                        </lineSegments>
                    )}
                    {ticks.xs.map(x => (
                        <Label3D key={`x${x}`} text={`${x}`} position={[x, rulerY, 0.5]} size={5} color="#94a3b8" />
                    ))}
                    {ticks.ys.map(y => (
                        <Label3D key={`y${y}`} text={`${y}`} position={[rulerX, y, 0.5]} size={5} color="#94a3b8" />
                    ))}
                </>
            )}
            <OriginTriad />
        </group>
    );
};

export default MachineBed;
