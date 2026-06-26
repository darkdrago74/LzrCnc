import React, { useState, useRef, Suspense, useEffect, useCallback } from 'react';
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
import PathRenderer from '../cam/PathRenderer';
import ToolpathOverlay from '../cam/ToolpathOverlay';
import type { SceneObject, DetectedPath, ToolpathPolygon } from '../../types';

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
    // Milling path overlay
    detectedPaths?: DetectedPath[];
    selectedPathIds?: string[];
    onPathSelect?: (id: string, multi: boolean) => void;
    /** Called when user finishes dragging a path — provides the new XY offset */
    onPathMove?: (id: string, position: [number, number, number]) => void;
    /** Computed toolpath polygons (offset outlines) to render as preview */
    toolpathPolygons?: ToolpathPolygon[];
}

const VisualizerScene: React.FC<VisualizerSceneProps> = ({
    machinePos, limits, gcode = [], laserBeamEnabled = true, machineSettings,
    previewContent, previewType, previewSize, objects, onSelectObject, onObjectUpdate,
    detectedPaths, selectedPathIds = [], onPathSelect, onPathMove, toolpathPolygons
}) => {
    const [is2D, setIs2D] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const objectRefs = useRef<Record<string, THREE.Group | null>>({});
    const pathGroupRefs = useRef<Record<string, THREE.Group | null>>({});
    const orbitRef = useRef<any>(null);

    // Stable callback so PathObject's useEffect doesn't re-run on every render
    const handlePathGroupMount = useCallback((id: string, g: THREE.Group | null) => {
        pathGroupRefs.current[id] = g;
    }, []);

    const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
    const selectedObject = objects?.find(o => o.selected);

    // Single selected path — only attach TransformControls when exactly 1 is chosen
    const singlePathId = selectedPathIds.length === 1 ? selectedPathIds[0] : null;

    // Transform Mode Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            if (key === 't') setTransformMode('translate');
            else if (key === 'r') setTransformMode('rotate');
            else if (key === 's') setTransformMode('scale');
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
                            onObjectChange={() => {
                                // Keep this empty if not needed continually, but it handles dragging state essentially
                            }}
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

                    {/* Milling path overlay — rendered from analyzed DXF/SVG */}
                    {detectedPaths && detectedPaths.length > 0 && onPathSelect && (
                        <PathRenderer
                            paths={detectedPaths}
                            selectedIds={selectedPathIds}
                            onSelect={onPathSelect}
                            onGroupMount={handlePathGroupMount}
                        />
                    )}

                    {/* TransformControls for a single selected milling path (translate only) */}
                    {singlePathId && pathGroupRefs.current[singlePathId] && (
                        <TransformControls
                            object={pathGroupRefs.current[singlePathId]!}
                            mode="translate"
                            onMouseUp={() => {
                                const g = pathGroupRefs.current[singlePathId];
                                if (g && onPathMove) {
                                    onPathMove(singlePathId, [
                                        g.position.x,
                                        g.position.y,
                                        g.position.z,
                                    ]);
                                }
                            }}
                        />
                    )}

                    {/* Toolpath offset preview — green/orange/yellow HDR lines */}
                    <ToolpathOverlay toolpaths={toolpathPolygons ?? []} />
                </group>
            </Canvas>

            {/* Controls Overlay */}
            <div className="absolute top-2 left-2 flex flex-col gap-2 pointer-events-none">
                <div className="text-[10px] text-gray-400 font-mono bg-black/60 p-2 rounded border border-white/10 shadow-lg">
                    <p className="mb-1"><span className="text-gray-300 font-bold">Pan:</span> Right-Click</p>
                    <p className="mb-1"><span className="text-gray-300 font-bold">View:</span> Left-Click</p>
                    <p><span className="text-gray-300 font-bold">Mode (T/R/S):</span> <span className="text-blue-400">{transformMode.toUpperCase()}</span></p>
                </div>
            </div>

            <div className="absolute top-2 left-[180px] pointer-events-auto flex flex-col gap-2">
                {selectedObject && (
                    <div className="flex gap-1 bg-black/60 p-1.5 rounded-lg border border-white/10 shadow-lg backdrop-blur-sm">
                        <button
                            title="Translate (T)"
                            onClick={() => setTransformMode('translate')}
                            className={`p-1.5 rounded transition-all ${transformMode === 'translate' ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.5)]' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M19 9l3 3-3 3M9 19l3 3 3 3M2 12h20M12 2v20" /></svg>
                        </button>
                        <button
                            title="Rotate (R)"
                            onClick={() => setTransformMode('rotate')}
                            className={`p-1.5 rounded transition-all ${transformMode === 'rotate' ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.5)]' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 6" /><path d="M21 3v6h-6" /></svg>
                        </button>
                        <button
                            title="Scale (S)"
                            onClick={() => setTransformMode('scale')}
                            className={`p-1.5 rounded transition-all ${transformMode === 'scale' ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.5)]' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 3l-6 6M21 3v6M21 3h-6M3 21l6-6M3 21v-6M3 21h6M14.5 9.5L9.5 14.5" /></svg>
                        </button>
                    </div>
                )}
                <button
                    onClick={() => setIs2D(!is2D)}
                    className="bg-black/60 hover:bg-white/10 text-gray-300 hover:text-white text-xs px-3 py-2 rounded-lg border border-white/10 shadow-lg font-bold transition-colors w-full tracking-wider"
                >
                    {is2D ? '3D VIEW' : '2D VIEW'}
                </button>
            </div>
        </div>
    );
};
export default VisualizerScene;
