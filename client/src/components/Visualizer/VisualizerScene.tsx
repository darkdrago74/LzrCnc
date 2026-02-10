import React, { useState, useRef, Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, TransformControls } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import MachineBed from './MachineBed';
import MachineHead from './MachineHead';
import GCodeViewer from './GCodeViewer';
import { BackgroundLaser } from './BackgroundLaser';

import { PreviewLayer } from './PreviewLayer';
import ObjectRenderer from './ObjectRenderer';
import type { SceneObject } from '../../types';

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
    objects?: SceneObject[];
    onSelectObject?: (id: string) => void;
    onObjectUpdate?: (id: string, updates: Partial<SceneObject>) => void;
}

const VisualizerScene: React.FC<VisualizerSceneProps> = ({
    machinePos, limits, gcode = [], laserBeamEnabled = true, machineSettings,
    previewContent, previewType, previewSize, objects, onSelectObject, onObjectUpdate
}) => {
    const [is2D, setIs2D] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const objectRefs = useRef<Record<string, THREE.Group | null>>({});
    const orbitRef = useRef<any>(null);

    const [transformMode, setTransformMode] = useState<'translate' | 'rotate'>('translate');
    const selectedObject = objects?.find(o => o.selected);

    // Toggle Transform Mode with 'R' key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() === 'r') {
                setTransformMode(prev => prev === 'translate' ? 'rotate' : 'translate');
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);


    // Dimensions from Settings (Priority) or Limits (Fallback)
    const width = machineSettings?.workbench?.width || limits?.x?.max || 200;
    const height = machineSettings?.workbench?.height || limits?.y?.max || 200;
    const origin = machineSettings?.workbench?.origin || 'bottom-left';

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

    // Sky Lasers at Y=1000 to be "Above".
    const targetCenter: [number, number, number] = [centerX, 0, -centerY];
    const cameraPos: [number, number, number] = [centerX, 400, -centerY + 300];

    return (
        <div ref={containerRef} className="w-full h-full relative bg-slate-900 overflow-hidden">
            <Canvas shadows dpr={[1, 2]} camera={{ position: cameraPos, fov: 45, far: 8000 }}>
                <OrbitControls
                    ref={orbitRef}
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
                        <group position={[targetCenter[0], 1000, targetCenter[2] - 1000]}>
                            <BackgroundLaser delay={0} spawnMode="vertical" height={6000} xRange={1000} zRange={100} particleSize={9} />
                            <BackgroundLaser delay={3.5} spawnMode="vertical" height={6000} xRange={1000} zRange={100} particleSize={9} />
                        </group>

                        <group position={[0, -20, 0]}>
                            <BackgroundLaser delay={1.5} spawnMode="flat" xRange={width || 300} zRange={height || 300} />
                            <BackgroundLaser delay={5.0} spawnMode="flat" xRange={width || 300} zRange={height || 300} />
                        </group>
                    </>
                )}

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

                    {/* Render Scene Objects */}
                    <Suspense fallback={null}>
                        {objects?.map(obj => (
                            <ObjectRenderer
                                key={obj.id}
                                ref={(el) => { objectRefs.current[obj.id] = el; }}
                                object={obj}
                                selected={!!obj.selected}
                                onSelect={() => onSelectObject && onSelectObject(obj.id)}
                            />
                        ))}
                    </Suspense>

                    {/* Transform Controls (Gizmo) */}
                    {selectedObject && objectRefs.current[selectedObject.id] && (
                        <TransformControls
                            object={objectRefs.current[selectedObject.id]!}
                            mode={transformMode}
                            onMouseUp={() => {
                                // Sync transformations back to App State on drag end
                                const obj = objectRefs.current[selectedObject.id];
                                if (obj && onObjectUpdate) {
                                    const newScale = [obj.scale.x, obj.scale.y, obj.scale.z] as [number, number, number];
                                    // Scale might be 1 if just translated.
                                    // Rotation is tricky (Euler vs Quaternion). ObjectRenderer uses Euler.
                                    // TransformControls modifies position/rotation/scale of the object directly.

                                    onObjectUpdate(selectedObject.id, {
                                        position: [obj.position.x, obj.position.y, obj.position.z],
                                        rotation: [
                                            obj.rotation.x * (180 / Math.PI),
                                            obj.rotation.y * (180 / Math.PI),
                                            obj.rotation.z * (180 / Math.PI)
                                        ],
                                        // Ensure scale is captured if scaled
                                        scale: newScale
                                    });
                                }
                            }}
                        />
                    )}

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

            {/* Controls Overlay */}
            <div className="absolute top-2 left-2 flex flex-col gap-2 pointer-events-none">
                <div className="text-[10px] text-gray-500 font-mono bg-black/50 p-1 rounded">
                    <p>Pan: Right-Click</p>
                    <p>Rotate Camera: Left-Click</p>
                    <p>Gizmo: {transformMode.toUpperCase()} (Press 'R' to toggle)</p>
                </div>
            </div>

            <div className="absolute top-2 left-[180px] pointer-events-auto flex flex-col gap-2">
                <button
                    onClick={() => setIs2D(!is2D)}
                    className="bg-gray-800 hover:bg-gray-700 text-white text-xs px-2 py-1 rounded border border-gray-600 shadow-md font-bold"
                >
                    {is2D ? '3D VIEW' : '2D VIEW'}
                </button>
            </div>
        </div>
    );
};
export default VisualizerScene;
