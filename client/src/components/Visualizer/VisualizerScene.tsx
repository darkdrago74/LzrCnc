import React, { useState, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, OrthographicCamera } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import MachineBed from './MachineBed';
import MachineHead from './MachineHead';
import GCodeViewer from './GCodeViewer';
import { BackgroundLaser } from './BackgroundLaser';

import { PreviewLayer } from './PreviewLayer';

interface VisualizerSceneProps {
    machinePos: { x: number, y: number, z: number };
    limits?: {
        x: { min: number, max: number };
        y: { min: number, max: number };
        z: { min: number, max: number };
    };
    gcode?: string[];
    laserBeamEnabled?: boolean;
    machineSettings?: any;
    // New Props for Cam Integration
    previewContent?: string | null;
    previewType?: 'vector' | 'raster';
    previewSize?: { width: number, height: number };
}

const VisualizerScene: React.FC<VisualizerSceneProps> = ({
    machinePos, limits, gcode = [], laserBeamEnabled = true, machineSettings,
    previewContent, previewType, previewSize
}) => {
    const [is2D, setIs2D] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Dimensions from Settings (Priority) or Limits (Fallback)
    const width = machineSettings?.workbench?.width || limits?.x?.max || 200;
    const height = machineSettings?.workbench?.height || limits?.y?.max || 200;
    const origin = machineSettings?.workbench?.origin || 'bottom-left';
    // Calculate Center of Bed for World Space Focus
    // We strictly assume Origin is Bottom-Left (0,0) for the drawing.
    // If Bed is 300x300, Center is (150, 150).
    // The visualizer Group is rotated -90 deg on X.
    // CNC (x, y, z) -> ThreeJS World.
    // Rotated by -PI/2 X:
    // (x, y, 0) -> (x, 0, y).
    // So target should be (width/2, 0, height/2).

    // However, if origin is Center, width/2 is 0?
    // Let's check origin.
    // If origin is 'center', range is -w/2 to w/2. Center is 0.
    // If origin is 'bottom-left', range is 0 to w. Center is w/2.

    let centerX = 0;
    let centerY = 0;

    if (origin === 'bottom-left') {
        centerX = width / 2;
        centerY = height / 2;
    } else if (origin === 'bottom-right') {
        centerX = -width / 2;
        centerY = height / 2;
    } else if (origin === 'top-right') {
        centerX = -width / 2;
        centerY = -height / 2;
    } else if (origin === 'top-left') {
        centerX = width / 2;
        centerY = -height / 2;
    }
    // If 'center', 0,0.

    // BUT MachineBed implementation might normalize this?
    // Let's assume standard BL positive quadrant for now or simply w/2 if we act as if 0,0 is corner.
    // Most users use BL origin.
    // Let's calculate the Offset Vector based on origin settings.

    // Simplification: The User sees the Grid starting at 0,0 (Cross).
    // The calculated centerX/centerY respects the 'origin' setting (quadrant).

    // Note: CNC Y maps to World Z in our rotation setup. centerWorld Y is 0.
    // REMARK: CNC Y maps to World -Z due to Rotation [-90, 0, 0]. Use -centerY for Z coord.
    // Sky Lasers at Y=1000 to be "Above".
    const targetCenter: [number, number, number] = [centerX, 0, -centerY];

    // Adjust camera position to be relative to the center
    const cameraPos: [number, number, number] = [centerX, 400, -centerY + 300];

    return (
        <div ref={containerRef} className="w-full h-full relative bg-slate-900 overflow-hidden">
            <Canvas shadows dpr={[1, 2]} camera={{ position: cameraPos, fov: 45, far: 8000 }}>
                <OrbitControls
                    makeDefault
                    target={targetCenter}
                    enableRotate={!is2D}
                    enableZoom={true}
                    enablePan={true}
                    minDistance={10}
                    maxDistance={2000}
                />

                <ambientLight intensity={0.5} />
                <pointLight position={[100, 200, 100]} intensity={0.8} />

                {/* Post Processing */}
                <EffectComposer enableNormalPass={false}>
                    <Bloom
                        luminanceThreshold={1}
                        mipmapBlur
                        intensity={2.5}
                        radius={0.8}
                    />
                </EffectComposer>

                {/* Background Laser Animation */}
                {laserBeamEnabled && (
                    <>
                        {/* Sky Lasers - "Shyfall" */}
                        {/* Position: Centered X, High Y (Sky), Back Z (Machine Y+ 1000mm offset from center) */}
                        {/* Spread: +/- 500mm means xRange 1000 */}
                        <group position={[targetCenter[0], 1000, targetCenter[2] - 1000]}>
                            <BackgroundLaser delay={0} spawnMode="vertical" height={6000} xRange={1000} zRange={100} particleSize={9} />
                            <BackgroundLaser delay={3.5} spawnMode="vertical" height={6000} xRange={1000} zRange={100} particleSize={9} />
                        </group>

                        {/* Bed Lasers */}
                        <group position={[0, -20, 0]}>
                            <BackgroundLaser delay={1.5} spawnMode="flat" xRange={width || 300} zRange={height || 300} />
                            <BackgroundLaser delay={5.0} spawnMode="flat" xRange={width || 300} zRange={height || 300} />
                        </group>
                    </>
                )}

                {/* ROTATE ENTIRE CONTENT TO MAP CNC-Z TO WORLD-Y */}
                <group rotation={[-Math.PI / 2, 0, 0]}>
                    <MachineBed
                        limits={limits}
                        width={width}
                        height={height}
                        visible={machineSettings?.workbench?.showWorkbench}
                        origin={origin}
                        axesSettings={machineSettings?.axes}
                    />
                    <MachineHead x={machinePos.x} y={machinePos.y} z={machinePos.z} />
                    {previewContent && previewSize && (
                        <PreviewLayer
                            fileContent={previewContent}
                            width={previewSize.width}
                            height={previewSize.height}
                            type={previewType || 'raster'}
                        />
                    )}
                    <GCodeViewer gcode={gcode} />
                </group>
            </Canvas>

            {/* View Toggle & Controls */}
            <div className="absolute top-2 left-2 flex flex-col gap-2 pointer-events-none">
                <div className="text-[10px] text-gray-500 font-mono bg-black/50 p-1 rounded">
                    <p>Pan: Right-Click</p>
                    <p>Rotate: Left-Click</p>
                    <p>Zoom: Scroll</p>
                    <p className="text-orange-400">DEBUG: Origin={origin}</p>
                    <p className="text-orange-400">Center=[{centerX}, {centerY}]</p>
                    <p className="text-orange-400">CamPos=[{cameraPos[0]}, {cameraPos[1]}, {cameraPos[2]}]</p>
                </div>
            </div>

            <div className="absolute top-2 left-[120px] pointer-events-auto flex flex-col gap-2">
                <button
                    onClick={() => setIs2D(!is2D)}
                    className="bg-gray-800 hover:bg-gray-700 text-white text-xs px-2 py-1 rounded border border-gray-600 shadow-md font-bold"
                >
                    {is2D ? 'SWITCH TO 3D' : 'SWITCH TO 2D'}
                </button>
                <button
                    onClick={() => window.location.reload()} // Simple reload to reset camera default
                    className="bg-gray-800 hover:bg-gray-700 text-white text-xs px-2 py-1 rounded border border-gray-600 shadow-md font-bold"
                >
                    RECENTER VIEW
                </button>
            </div>
        </div>
    );
};
export default VisualizerScene;
