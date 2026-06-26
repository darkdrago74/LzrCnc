/**
 * PathRenderer.tsx
 *
 * Renders DetectedPath[] as Three.js line geometry inside the visualizer.
 *
 * Selection behaviour:
 *   – Base line changes to white
 *   – A second HDR glow line is added (color > 1.0 → triggers Bloom post-processing)
 *   – Each path lives in a <group> so TransformControls (translate) can attach to it
 *
 * Color scheme:
 *   Closed path  → cyan  (#00e5ff)
 *   Open path    → amber (#ffab00)
 *   Hovered      → lighter cyan
 *   Selected     → white base + HDR cyan glow (blooms)
 */

import React, { useMemo, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { DetectedPath } from '../../types';

// ── Color constants ───────────────────────────────────────────────────────────
const COLOR_CLOSED   = new THREE.Color('#00e5ff');
const COLOR_OPEN     = new THREE.Color('#ffab00');
const COLOR_SELECTED = new THREE.Color('#ffffff');
const COLOR_HOVER    = new THREE.Color('#44ccee');

/** Z above the bed so lines never clip into the surface */
const Z_BASE = 0.8;
/** Glow line is drawn slightly higher to avoid z-fighting with the base line */
const Z_GLOW = 1.4;

/**
 * HDR color (luminance > 1.0) — triggers the Bloom EffectComposer that is
 * already in VisualizerScene (luminanceThreshold = 1).
 * Values: R=0, G=3, B=3  →  luminance ≈ 2.1
 */
const COLOR_GLOW_CLOSED = new THREE.Color(0, 3, 3);
const COLOR_GLOW_OPEN   = new THREE.Color(3, 2, 0);

// ── Geometry builder ──────────────────────────────────────────────────────────

function buildLineGeo(points: DetectedPath['points'], z: number) {
    const pos = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
        pos[i * 3]     = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = z;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return geo;
}

// ── Single path ───────────────────────────────────────────────────────────────

interface PathObjectProps {
    path: DetectedPath;
    selected: boolean;
    onSelect: (multiSelect: boolean) => void;
    /** Called with the THREE.Group ref so the parent can wire TransformControls */
    onGroupMount: (id: string, g: THREE.Group | null) => void;
}

const PathObject: React.FC<PathObjectProps> = ({ path, selected, onSelect, onGroupMount }) => {
    const [hovered, setHovered] = React.useState(false);
    const groupRef = useRef<THREE.Group>(null);

    // Register/unregister group ref with parent (needed for TransformControls)
    useEffect(() => {
        const g = groupRef.current;
        if (g) onGroupMount(path.id, g);
        return () => onGroupMount(path.id, null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path.id]); // onGroupMount is stable (useCallback in parent)

    // Geometries — created once per path
    const baseGeo = useMemo(() => buildLineGeo(path.points, Z_BASE), [path.points]);
    const glowGeo = useMemo(() => buildLineGeo(path.points, Z_GLOW), [path.points]);

    // Materials — mutated in-place on state changes to avoid re-creation
    const baseMat = useMemo(
        () => new THREE.LineBasicMaterial({ color: path.closed ? COLOR_CLOSED : COLOR_OPEN }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );
    const glowMat = useMemo(
        () => new THREE.LineBasicMaterial({
            color: path.closed ? COLOR_GLOW_CLOSED : COLOR_GLOW_OPEN,
            transparent: true,
            opacity: 0.85,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    // Keep base material colour in sync
    useEffect(() => {
        if (selected) {
            baseMat.color.copy(COLOR_SELECTED);
        } else if (hovered) {
            baseMat.color.copy(COLOR_HOVER);
        } else {
            baseMat.color.copy(path.closed ? COLOR_CLOSED : COLOR_OPEN);
        }
        baseMat.needsUpdate = true;
    }, [selected, hovered, path.closed, baseMat]);

    // Stable Three.js Line objects (geometry & material don't change after mount)
    const baseLine = useMemo(() => new THREE.Line(baseGeo, baseMat), [baseGeo, baseMat]);
    const glowLine = useMemo(() => new THREE.Line(glowGeo, glowMat), [glowGeo, glowMat]);

    return (
        <group
            ref={groupRef}
            onClick={(e: any) => {
                e.stopPropagation();
                onSelect(e.ctrlKey || e.metaKey || e.shiftKey);
            }}
            onPointerOver={(e: any) => { e.stopPropagation(); setHovered(true); }}
            onPointerOut={(e: any)  => { e.stopPropagation(); setHovered(false); }}
        >
            {/* Base line — always visible */}
            <primitive object={baseLine} />

            {/* Glow line — only when selected, triggers Bloom post-processing */}
            {selected && <primitive object={glowLine} />}
        </group>
    );
};

// ── Main renderer ─────────────────────────────────────────────────────────────

export interface PathRendererProps {
    paths: DetectedPath[];
    selectedIds: string[];
    onSelect: (id: string, multiSelect: boolean) => void;
    /** Exposes each path's THREE.Group ref so the parent can attach TransformControls */
    onGroupMount?: (id: string, g: THREE.Group | null) => void;
}

const PathRenderer: React.FC<PathRendererProps> = ({ paths, selectedIds, onSelect, onGroupMount }) => {
    const noop = useCallback((_id: string, _g: THREE.Group | null) => {}, []);
    const mountFn = onGroupMount ?? noop;

    if (!paths || paths.length === 0) return null;

    return (
        <group name="path-renderer">
            {paths.map(path => (
                <PathObject
                    key={path.id}
                    path={path}
                    selected={selectedIds.includes(path.id)}
                    onSelect={(multi) => onSelect(path.id, multi)}
                    onGroupMount={mountFn}
                />
            ))}
        </group>
    );
};

export default PathRenderer;
