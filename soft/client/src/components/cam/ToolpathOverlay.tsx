/**
 * ToolpathOverlay.tsx
 *
 * Renders computed toolpath polygons (offset outlines) returned by the server
 * after G-code generation. Shows where the tool center will actually travel.
 *
 * HDR colors trigger the existing Bloom post-processor in VisualizerScene:
 *   Inside  → bright green  (G component > 1)
 *   Outside → bright orange (R+G components > 1)
 *   On-line → bright yellow (R+G > 1)
 *
 * Rendered above path overlay (Z = 2.5) to stay visible.
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';
import type { ToolpathPolygon } from '../../types';

const Z_TOOLPATH = 2.5;

// HDR colors — luminance > 1 triggers Bloom (luminanceThreshold=1 in VisualizerScene)
const HDR_INSIDE   = new THREE.Color(0, 2.5, 0.5);   // green
const HDR_OUTSIDE  = new THREE.Color(2.5, 1.0, 0);   // orange
const HDR_ON       = new THREE.Color(2.5, 2.5, 0);   // yellow

function colorFor(cutSide: ToolpathPolygon['cutSide']) {
    if (cutSide === 'inside')  return HDR_INSIDE;
    if (cutSide === 'outside') return HDR_OUTSIDE;
    return HDR_ON;
}

// ── Single toolpath line ──────────────────────────────────────────────────────

const ToolpathLine: React.FC<{ tp: ToolpathPolygon }> = ({ tp }) => {
    const geo = useMemo(() => {
        const pos = new Float32Array(tp.points.length * 3);
        tp.points.forEach((p, i) => {
            pos[i * 3]     = p.x;
            pos[i * 3 + 1] = p.y;
            pos[i * 3 + 2] = Z_TOOLPATH;
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        return g;
    }, [tp.points]);

    const mat = useMemo(
        () => new THREE.LineBasicMaterial({ color: colorFor(tp.cutSide) }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [tp.cutSide]
    );

    const line = useMemo(() => new THREE.Line(geo, mat), [geo, mat]);

    return <primitive object={line} />;
};

// ── Main overlay component ────────────────────────────────────────────────────

interface ToolpathOverlayProps {
    toolpaths: ToolpathPolygon[];
}

const ToolpathOverlay: React.FC<ToolpathOverlayProps> = ({ toolpaths }) => {
    if (!toolpaths || toolpaths.length === 0) return null;

    return (
        <group name="toolpath-overlay">
            {toolpaths.map(tp => (
                <ToolpathLine key={tp.id} tp={tp} />
            ))}
        </group>
    );
};

export default ToolpathOverlay;
