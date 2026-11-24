/**
 * 3D layer of the milling workflow (machine coordinates, Z up):
 *  - translucent stock block sitting on the bed (z = 0 … thickness)
 *  - selectable contours drawn on the stock top
 *  - computed tool-centre paths (per operation type)
 *  - material-removal simulation as a heightfield mesh
 */
import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { MillContour, MillResult, MillStock, Heightfield } from '../../utils/millJob';

const OP_COLOR: Record<string, string> = { face: '#a78bfa', pocket: '#22d3ee', profile: '#fb923c' };

const lineGeo = (pts: [number, number][], z: number, closed: boolean) => {
    const arr: number[] = [];
    for (const [x, y] of pts) arr.push(x, y, z);
    if (closed && pts.length > 2) arr.push(pts[0][0], pts[0][1], z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    return g;
};

const ContourLine: React.FC<{ c: MillContour; z: number; selected: boolean; onSelect?: (id: string, multi: boolean) => void }> = ({ c, z, selected, onSelect }) => {
    const [hover, setHover] = useState(false);
    const geo = useMemo(() => lineGeo(c.points, z, c.closed), [c.points, c.closed, z]);
    useEffect(() => () => geo.dispose(), [geo]);
    const color = selected ? '#ffffff' : hover ? '#7dd3fc' : c.closed ? '#22d3ee' : '#fbbf24';
    const line = useMemo(() => new THREE.Line(geo, new THREE.LineBasicMaterial({ toneMapped: false })), [geo]);
    useEffect(() => { (line.material as THREE.LineBasicMaterial).color.set(color); }, [line, color]);
    return (
        <primitive
            object={line}
            onClick={(e: { stopPropagation: () => void; ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean; nativeEvent?: MouseEvent }) => {
                e.stopPropagation();
                const n = e.nativeEvent;
                onSelect?.(c.id, !!(n?.ctrlKey || n?.shiftKey || n?.metaKey));
            }}
            onPointerOver={(e: { stopPropagation: () => void }) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}
        />
    );
};

const StockBlock: React.FC<{ stock: MillStock; dim: boolean }> = ({ stock, dim }) => {
    const { width: w, height: h, thickness: t, x, y } = stock;
    const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, t)), [w, h, t]);
    useEffect(() => () => edges.dispose(), [edges]);
    return (
        <group position={[x + w / 2, y + h / 2, t / 2]}>
            {!dim && (
                <mesh renderOrder={-1}>
                    <boxGeometry args={[w, h, t]} />
                    <meshStandardMaterial color="#b08154" transparent opacity={0.35} depthWrite={false} roughness={0.9} />
                </mesh>
            )}
            <lineSegments geometry={edges}>
                <lineBasicMaterial color="#f59e0b" transparent opacity={dim ? 0.35 : 0.8} />
            </lineSegments>
            {/* Work zero marker: lower-left corner on the top (or bottom) of the stock */}
            <group position={[-w / 2, -h / 2, stock.zZero === 'bottom' ? -t / 2 : t / 2]}>
                <mesh><sphereGeometry args={[Math.max(0.8, Math.min(w, h) / 120), 12, 12]} /><meshBasicMaterial color="#f43f5e" /></mesh>
                <Html position={[0, 0, 2]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
                    <div className="text-[10px] font-mono text-rose-300 bg-slate-950/70 px-1 rounded whitespace-nowrap -translate-x-1/2 -translate-y-4">{stock.zZero === 'bottom' ? 'Z0 bottom' : 'Z0 top'}</div>
                </Html>
            </group>
        </group>
    );
};

/** Heightfield (remaining material) as a closed, depth-coloured mesh. */
const SimMesh: React.FC<{ hf: Heightfield; version: number }> = ({ hf, version }) => {
    const geo = useMemo(() => {
        const { nx, ny } = hf;
        const g = new THREE.BufferGeometry();
        const top = nx * ny;
        const pos = new Float32Array((top + 2 * (nx + ny) * 2) * 3);
        const col = new Float32Array(pos.length);
        const idx: number[] = [];
        for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
            const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
            idx.push(a, b, d, a, d, c);
        }
        // Side walls: boundary nodes duplicated at z = 0 and z = h
        const ring: number[] = [];
        for (let i = 0; i < nx; i++) ring.push(i);
        for (let j = 1; j < ny; j++) ring.push(j * nx + nx - 1);
        for (let i = nx - 2; i >= 0; i--) ring.push((ny - 1) * nx + i);
        for (let j = ny - 2; j > 0; j--) ring.push(j * nx);
        let v = top;
        const wallStart = v;
        for (let k = 0; k < ring.length; k++) {
            const a = wallStart + k * 2, b = a + 1, a2 = wallStart + ((k + 1) % ring.length) * 2, b2 = a2 + 1;
            idx.push(a, a2, b2, a, b2, b);
            v += 2;
        }
        g.setIndex(idx);
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.userData.ring = ring;
        return g;
    }, [hf]);

    useEffect(() => {
        const { nx, ny, dx, dy, x0, y0, thickness: T, h } = hf;
        const pos = geo.getAttribute('position') as THREE.BufferAttribute;
        const col = geo.getAttribute('color') as THREE.BufferAttribute;
        const p = pos.array as Float32Array, c = col.array as Float32Array;
        const wood = new THREE.Color('#c8955c'), cut = new THREE.Color('#6b4423'), deep = new THREE.Color('#3b2414'), tmp = new THREE.Color();
        const shade = (z: number) => {
            const d = T - z;
            if (d < 0.01) return tmp.copy(wood);
            return tmp.copy(cut).lerp(deep, Math.min(1, d / Math.max(1, T)));
        };
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const k = j * nx + i, z = h[k];
            p[k * 3] = x0 + i * dx; p[k * 3 + 1] = y0 + j * dy; p[k * 3 + 2] = z;
            const s = shade(z); c[k * 3] = s.r; c[k * 3 + 1] = s.g; c[k * 3 + 2] = s.b;
        }
        const ring: number[] = geo.userData.ring;
        const side = new THREE.Color('#a87645');
        let v = nx * ny;
        for (const k of ring) {
            const x = x0 + (k % nx) * dx, y = y0 + Math.floor(k / nx) * dy;
            p.set([x, y, 0, x, y, h[k]], v * 3);
            c.set([side.r, side.g, side.b, side.r, side.g, side.b], v * 3);
            v += 2;
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
    }, [geo, hf, version]);

    useEffect(() => () => geo.dispose(), [geo]);

    return (
        <mesh geometry={geo} castShadow receiveShadow>
            <meshStandardMaterial vertexColors roughness={0.85} metalness={0} side={THREE.DoubleSide} />
        </mesh>
    );
};

export interface MillSceneProps {
    stock: MillStock;
    contours: MillContour[];
    selectedContourIds: string[];
    onContourSelect?: (id: string, multi: boolean) => void;
    result?: MillResult | null;
    showToolpaths?: boolean;
    sim?: { hf: Heightfield; version: number } | null;
    /** Area swept by the tool (incl. radius), drawn as the framing rectangle at safe height above the stock. */
    cutArea?: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

const FrameRect: React.FC<{ a: NonNullable<MillSceneProps['cutArea']>; z: number }> = ({ a, z }) => {
    const line = useMemo(() => {
        const g = lineGeo([[a.minX, a.minY], [a.maxX, a.minY], [a.maxX, a.maxY], [a.minX, a.maxY]], z, true);
        const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: '#34d399', dashSize: 3, gapSize: 2, toneMapped: false }));
        l.computeLineDistances();
        return l;
    }, [a.minX, a.minY, a.maxX, a.maxY, z]);
    useEffect(() => () => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }, [line]);
    return (
        <group>
            <primitive object={line} />
            <Html position={[a.minX, a.maxY, z]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
                <div className="text-[10px] font-mono text-emerald-300 bg-slate-950/70 px-1 rounded whitespace-nowrap -translate-y-5">frame {(a.maxX - a.minX).toFixed(1)}×{(a.maxY - a.minY).toFixed(1)}</div>
            </Html>
        </group>
    );
};

const MillScene: React.FC<MillSceneProps> = ({ stock, contours, selectedContourIds, onContourSelect, result, showToolpaths = true, sim, cutArea }) => {
    const top = stock.thickness;
    const toolpathLines = useMemo(() => (result?.toolpaths ?? []).map((tp, i) => ({
        key: `${tp.opId}-${i}`,
        line: new THREE.Line(lineGeo(tp.points, top + 0.25, tp.closed), new THREE.LineBasicMaterial({ color: OP_COLOR[tp.type] ?? '#ffffff', toneMapped: false })),
    })), [result, top]);
    useEffect(() => () => toolpathLines.forEach(t => { t.line.geometry.dispose(); (t.line.material as THREE.Material).dispose(); }), [toolpathLines]);

    return (
        <group name="mill-scene">
            <StockBlock stock={stock} dim={!!sim} />
            {sim && <SimMesh hf={sim.hf} version={sim.version} />}
            {!sim && contours.map(c => (
                <ContourLine key={c.id} c={c} z={top + 0.4} selected={selectedContourIds.includes(c.id)} onSelect={onContourSelect} />
            ))}
            {showToolpaths && !sim && toolpathLines.map(t => <primitive key={t.key} object={t.line} />)}
            {cutArea && !sim && <FrameRect a={cutArea} z={top + Math.max(1, stock.safeZ)} />}
        </group>
    );
};

export default MillScene;
