import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';

interface PreviewLayerProps {
    fileContent: string | null;
    width: number;
    height: number;
    type: 'vector' | 'raster';
    originalWidth?: number;
    originalHeight?: number;
}

export const PreviewLayer: React.FC<PreviewLayerProps> = ({ fileContent, width, height, type }) => {

    // Raster Preview (Image Plane)
    const texture = useMemo(() => {
        if (type === 'raster' && fileContent) {
            const loader = new THREE.TextureLoader();
            return loader.load(fileContent);
        }
        return null;
    }, [fileContent, type]);

    // Vector Preview
    // Parsing SVG string to paths is complex in frontend without heavy lib.
    // However, if the fileContent is raw SVG string, we can use SVGLoader?
    // SVGLoader is not in standard THREE, but in examples/jsm. 
    // importing from three-stdlib or @react-three/drei usually easier.
    // For now, let's stick to Raster preview as Priority 1 (LaserWeb4 style image on bed).

    if (type === 'raster' && texture) {
        return (
            <mesh
                position={[width / 2, 0.5, -height / 2]} // Center on bed (assuming bed origin 0,0 is bottom-left) -- Wait, Bed Visualizer coords?
                // Visualizer Scene rotates X -90. So Y is Up (Z of bed).
                // Bed plane is on X/Z (in visualizer local) or X/Y (in CNC coords).
                // Our GCodeViewer uses [x,y,z] from GCode.
                // If GCode uses X/Y, then MachineBed is on Z=0 plane?
                // VisualizerScene uses rotation={[-Math.PI / 2, 0, 0]}.
                // So +Z(CNC) is +Y(World). +Y(CNC) is -Z(World).
                // So a Plane should be on x, y. 
                rotation={[0, 0, 0]}
            >
                <planeGeometry args={[width, height]} />
                <meshBasicMaterial
                    map={texture}
                    transparent
                    opacity={0.7}
                    side={THREE.DoubleSide}
                />
            </mesh>
        );
    }

    // Placeholder for Vector
    // If we have an SVG, maybe we can just overlay it as a Texture if converted to DataURL?
    // FileUpload handles SVG -> Text.
    // We could render SVG to Canvas -> DataURL -> Texture? 
    // That's effectively what DitheringPreview does.

    return null;
};
