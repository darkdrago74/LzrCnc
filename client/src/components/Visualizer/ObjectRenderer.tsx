import React, { useMemo, forwardRef } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import type { SceneObject } from '../../types';

const ObjectRenderer = forwardRef<THREE.Group, { object: SceneObject; selected: boolean; onSelect: () => void }>(({ object, selected, onSelect }, ref) => {
    // Load Texture for images/SVGs
    const textureUrl = useMemo(() => {
        if (object.type === 'stl') return null;
        if (object.content.startsWith('http') || object.content.startsWith('blob:') || object.content.startsWith('data:')) {
            return object.content;
        }
        // Assume SVG string
        const blob = new Blob([object.content], { type: 'image/svg+xml' });
        return URL.createObjectURL(blob);
    }, [object.content, object.type]);

    const texture = useLoader(THREE.TextureLoader, textureUrl || '');

    // Calculate Aspect Ratio / Dimensions
    // Default 100mm if no info
    const width = 100;
    const height = texture.image ? width * (texture.image.height / texture.image.width) : 100;

    if (object.type === 'stl') {
        return <group ref={ref} />; // Layout placeholder for STL
    }

    return (
        <group
            ref={ref}
            position={new THREE.Vector3(...object.position)}
            rotation={new THREE.Euler((object.rotation[0] * Math.PI) / 180, (object.rotation[1] * Math.PI) / 180, (object.rotation[2] * Math.PI) / 180)}
            scale={new THREE.Vector3(...object.scale)}
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
        >
            {/* Main Plane */}
            <mesh>
                <planeGeometry args={[width, height]} />
                <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} />
            </mesh>

            {/* Selection Highlight */}
            {selected && (
                <mesh>
                    <boxGeometry args={[width, height, 1]} />
                    <meshBasicMaterial wireframe color="#FFFF00" />
                </mesh>
            )}

            {/* Debug Axis */}
            {selected && <axesHelper args={[50]} />}
        </group>
    );
});

export default ObjectRenderer;
