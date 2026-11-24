import React, { useMemo, forwardRef } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import type { SceneObject } from '../../types';
import { getSvgInfo, svgForTexture } from '../../utils/svgUtils';
import GCodeViewer from './GCodeViewer';

interface Props { object: SceneObject; selected: boolean; onSelect: () => void }

const DEG = Math.PI / 180;

const isUrl = (s: string) => /^(https?:|blob:|data:)/.test(s);

/** Textured plane lying on the XY bed, centered on the object position. */
const TexturedPlane: React.FC<{ object: SceneObject; selected: boolean }> = ({ object, selected }) => {
    // A deterministic data URL (not a blob URL) is required: useLoader suspends, and a suspended first
    // render discards memoized values, so a fresh blob URL per attempt would never resolve.
    const { url, svgSize } = useMemo(() => {
        if (isUrl(object.content)) return { url: object.content, svgSize: null as null | [number, number] };
        const info = getSvgInfo(object.content, object.svgUnitsMm);
        const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgForTexture(object.content, info));
        return { url, svgSize: [info.widthMm, info.heightMm] as [number, number] };
    }, [object.content, object.svgUnitsMm]);

    const texture = useLoader(THREE.TextureLoader, url);
    useMemo(() => { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8; }, [texture]);

    const img = texture.image as { width: number; height: number } | undefined;
    const [w, h] = object.size ?? svgSize ?? (img ? [img.width * 25.4 / 96, img.height * 25.4 / 96] : [100, 100]);

    return (
        <group>
            <mesh>
                <planeGeometry args={[w, h]} />
                <meshBasicMaterial map={texture} transparent toneMapped={false} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
            {selected && (
                <lineSegments position={[0, 0, 0.05]}>
                    <edgesGeometry args={[new THREE.PlaneGeometry(w, h)]} />
                    <lineBasicMaterial color="#3b82f6" toneMapped={false} />
                </lineSegments>
            )}
        </group>
    );
};

const ObjectRenderer = forwardRef<THREE.Group, Props>(({ object, selected, onSelect }, ref) => {
    if (object.type === 'stl') return <group ref={ref} />;

    if (object.type === 'gcode') {
        const o = object.gcodeOptions;
        return (
            <group ref={ref} position={[o?.offsetX ?? 0, o?.offsetY ?? 0, 0]}>
                <GCodeViewer gcode={object.content.split(/\r?\n/)} />
            </group>
        );
    }

    return (
        <group
            ref={ref}
            // Slightly above the bed so the artwork never z-fights with the grid
            position={[object.position[0], object.position[1], (object.position[2] || 0) + 0.1]}
            rotation={[object.rotation[0] * DEG, object.rotation[1] * DEG, object.rotation[2] * DEG]}
            scale={object.scale}
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
        >
            <TexturedPlane object={object} selected={selected} />
        </group>
    );
});

export default ObjectRenderer;
