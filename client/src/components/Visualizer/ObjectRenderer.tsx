import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import type { SceneObject } from '../cam/DesignerToolbar';
import { PreviewLayer } from './PreviewLayer';

// We need a sub-component that handles the content of an object
const ObjectContent: React.FC<{ object: SceneObject }> = ({ object }) => {
    // If it's a file (Image/SVG URL or String)
    // We reuse PreviewLayer logic: Load Texture.
    // Simplifying: Just render a Plane with the texture.

    // BUT we need to parse content. 
    // If SVG String -> DataURI.

    const textureUrl = React.useMemo(() => {
        if (object.content.startsWith('http') || object.content.startsWith('blob:') || object.content.startsWith('data:')) {
            return object.content;
        }
        // Assume SVG string
        const blob = new Blob([object.content], { type: 'image/svg+xml' });
        return URL.createObjectURL(blob);
    }, [object.content]);

    // For now, reuse PreviewLayer logic or simple ImageLoader
    // Let's rely on standard Image Plane

    // We need dimensions. 
    // We default to 100x100 if unknown? 
    // The texture loader should help.

    // Better: Render a placeholder geometry until loaded?

    return (
        <PreviewLayer fileContent={textureUrl || ''} width={100} height={100} type="raster" />
    );
};
// Actually PreviewLayer assumes full bed width/height which is wrong for small objects.
// It tries to cover.
// We need a specific "ObjectMesh".

const ObjectMesh: React.FC<{ object: SceneObject; selected: boolean; onSelect: () => void }> = ({ object, selected, onSelect }) => {
    // Load Texture to get aspect ratio
    const textureUrl = React.useMemo(() => {
        if (object.type === 'stl') return null;
        if (object.content.startsWith('http') || object.content.startsWith('blob:') || object.content.startsWith('data:')) {
            return object.content;
        }
        const blob = new Blob([object.content], { type: 'image/svg+xml' });
        return URL.createObjectURL(blob); // Memory leak? Need revoke.
    }, [object.content]);

    const texture = useLoader(THREE.TextureLoader, textureUrl || ''); // Keeps caching

    // Calculate Dimensions
    const width = 100; // Default
    const height = texture.image ? width * (texture.image.height / texture.image.width) : 100;

    // If STL, render StlModel
    if (object.type === 'stl') {
        // ... (Import StlModel logic)
        return <group />; // Todo
    }

    return (
        <group
            position={new THREE.Vector3(...object.position)}
            rotation={new THREE.Euler(...object.rotation)}
            scale={new THREE.Vector3(...object.scale)}
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
        >
            <mesh>
                <planeGeometry args={[width, height]} />
                <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} />
            </mesh>
            {selected && <mesh>
                <boxGeometry args={[width, height, 1]} />
                <meshBasicMaterial wireframe color="yellow" />
            </mesh>}
        </group>
    );
};
