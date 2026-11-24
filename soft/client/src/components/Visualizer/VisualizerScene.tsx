import React, { useState, useRef, Suspense, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, TransformControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import MachineBed from './MachineBed';
import MachineHead from './MachineHead';
import GCodeViewer from './GCodeViewer';
import { BackgroundLaser } from './BackgroundLaser';
import ObjectRenderer from './ObjectRenderer';
import MillScene, { type MillSceneProps } from './MillScene';
import type { SceneObject, MachineSettings } from '../../types';
import { getBedExtents } from '../../utils/machineGeometry';
import type { BedExtents } from '../../utils/machineGeometry';
import { Box, Square, Maximize, RectangleHorizontal, Sparkles } from 'lucide-react';

// The whole scene works in machine coordinates: XY is the bed plane and +Z points up/out of it.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

type ViewMode = '3d' | 'top' | 'front';

interface VisualizerSceneProps {
    machinePos: { x: number, y: number, z: number };
    limits?: {
        x: { min: number, max: number };
        y: { min: number, max: number };
        z: { min: number, max: number };
    };
    gcode?: string[];
    /** Raw G-code line index reached by the running job (cuts before it are drawn as done) */
    progressLine?: number;
    spindle?: number;
    laserBeamEnabled?: boolean;
    machineSettings?: Partial<MachineSettings> | null;
    objects?: SceneObject[];
    onSelectObject?: (id: string) => void;
    onObjectUpdate?: (id: string, updates: Partial<SceneObject>) => void;
    /** Milling workspace: shown while the Mill tab is open or a milling program is loaded. */
    mill?: MillSceneProps & { active: boolean };
    /** The loaded G-code is a milling program. */
    gcodeIsMill?: boolean;
    /** G-code Z of the stock top in the loaded milling program (0: Z0 on top, thickness: Z0 on bottom). */
    gcodeTopZ?: number;
}

/** Moves the camera to a preset (top / front / 3D) framing the whole bed, with a short ease. */
const CameraRig: React.FC<{ bed: BedExtents; view: ViewMode; nonce: number }> = ({ bed, view, nonce }) => {
    const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: any };
    const anim = useRef<{ fromP: THREE.Vector3; toP: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number } | null>(null);

    useEffect(() => {
        if (!controls) return;
        const size = Math.max(bed.width, bed.height, 50);
        const fov = (camera.fov * Math.PI) / 180;
        const aspect = Math.max(camera.aspect, 0.5);
        // Distance so the bed fits both vertically and horizontally
        const dist = (size / 2) / Math.tan(fov / 2) * Math.max(1, 1 / aspect) * 1.25;
        const target = new THREE.Vector3(bed.centerX, bed.centerY, 0);
        let pos: THREE.Vector3;
        if (view === 'top') pos = new THREE.Vector3(bed.centerX, bed.centerY - dist * 0.0005, dist);
        else if (view === 'front') pos = new THREE.Vector3(bed.centerX, bed.centerY - dist, Math.max(bed.depth, 40));
        else pos = new THREE.Vector3(bed.centerX - dist * 0.25, bed.centerY - dist * 0.8, dist * 0.65);

        controls.minAzimuthAngle = -Infinity;
        controls.maxAzimuthAngle = Infinity;
        controls.minPolarAngle = 0;
        anim.current = { fromP: camera.position.clone(), toP: pos, fromT: controls.target.clone(), toT: target, t: 0 };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nonce, controls, bed.width, bed.height, bed.centerX, bed.centerY]);

    useFrame((_, delta) => {
        const a = anim.current;
        if (!a || !controls) return;
        a.t = Math.min(1, a.t + delta / 0.45);
        const e = 1 - Math.pow(1 - a.t, 3);
        camera.position.lerpVectors(a.fromP, a.toP, e);
        controls.target.lerpVectors(a.fromT, a.toT, e);
        camera.up.set(0, 0, 1);
        controls.update();
        if (a.t >= 1) {
            anim.current = null;
            if (view === 'top') {
                // Lock the 2D view: looking straight down, X right / Y up on screen.
                controls.minPolarAngle = 0;
                controls.maxPolarAngle = 0;
                const az = controls.getAzimuthalAngle();
                controls.minAzimuthAngle = az;
                controls.maxAzimuthAngle = az;
            }
        }
    });
    return null;
};

const VisualizerScene: React.FC<VisualizerSceneProps> = ({
    machinePos, limits, gcode = [], progressLine = -1, spindle = 0, laserBeamEnabled = false, machineSettings,
    objects, onSelectObject, onObjectUpdate, mill, gcodeIsMill = false, gcodeTopZ = 0
}) => {
    const [view, setView] = useState<ViewMode>('3d');
    const [viewNonce, setViewNonce] = useState(0);
    const objectRefs = useRef<Record<string, THREE.Group | null>>({});
    const [, forceRender] = useState(0);

    const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
    const selectedObject = objects?.find(o => o.selected && o.type !== 'gcode' && o.type !== 'stl');
    const showMill = !!mill && (mill.active || gcodeIsMill);
    // Artwork sits on top of the stock while milling
    const objectLift = showMill && mill ? mill.stock.thickness : 0;
    // Bed height of work Z0: the loaded mill program decides, otherwise the stock setup.
    const workZ0 = !showMill || !mill ? 0
        : gcodeIsMill ? mill.stock.thickness - gcodeTopZ
        : mill.stock.zZero === 'bottom' ? 0 : mill.stock.thickness;

    // Refs are attached after the first render of a new selection; re-render once so the gizmo can attach.
    useEffect(() => { forceRender(n => n + 1); }, [selectedObject?.id]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            const key = e.key.toLowerCase();
            if (key === 't') setTransformMode('translate');
            else if (key === 'r') setTransformMode('rotate');
            else if (key === 's') setTransformMode('scale');
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const bed = useMemo(
        () => getBedExtents(machineSettings, limits),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [machineSettings?.workbench?.width, machineSettings?.workbench?.height, machineSettings?.workbench?.depth, machineSettings?.workbench?.origin, limits?.x?.max, limits?.y?.max]
    );

    const setPreset = (v: ViewMode) => { setView(v); setViewNonce(n => n + 1); };

    const initialCam = useMemo<[number, number, number]>(
        () => [bed.centerX, bed.centerY - Math.max(bed.width, bed.height) * 1.4, Math.max(bed.width, bed.height) * 1.1],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    const commitTransform = () => {
        if (!selectedObject || !onObjectUpdate) return;
        const obj = objectRefs.current[selectedObject.id];
        if (!obj) return;
        const toDeg = (r: number) => Math.round(r * (180 / Math.PI) * 100) / 100;
        onObjectUpdate(selectedObject.id, {
            position: [obj.position.x, obj.position.y, selectedObject.position[2] || 0],
            rotation: [0, 0, toDeg(obj.rotation.z)],
            scale: [obj.scale.x, obj.scale.y, 1],
        });
    };

    const viewButton = (v: ViewMode, label: string, Icon: React.ComponentType<{ size?: number }>, title: string) => (
        <button
            title={title}
            onClick={() => setPreset(v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold tracking-wide transition-colors ${view === v ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
        >
            <Icon size={14} /> {label}
        </button>
    );

    return (
        <div className="w-full h-full relative overflow-hidden bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950">
            <Canvas
                shadows
                dpr={[1, 2]}
                camera={{ position: initialCam, up: [0, 0, 1], fov: 40, near: 0.5, far: 20000 }}
                onPointerMissed={() => { /* clicking empty space keeps selection; use Esc in panels to clear */ }}
            >
                <OrbitControls
                    makeDefault
                    enableRotate={view !== 'top'}
                    enableDamping
                    dampingFactor={0.12}
                    screenSpacePanning
                    // Never orbit below the bed: Z must always point up/out of the screen
                    maxPolarAngle={view === 'top' ? 0 : Math.PI / 2 - 0.03}
                    minDistance={5}
                    maxDistance={6000}
                />
                <CameraRig bed={bed} view={view} nonce={viewNonce} />

                <hemisphereLight args={['#e2e8f0', '#0f172a', 0.9]} />
                <directionalLight position={[bed.centerX + 200, bed.centerY - 300, 600]} intensity={1.1} castShadow />

                {laserBeamEnabled && (
                    <>
                        <EffectComposer enableNormalPass={false}>
                            <Bloom luminanceThreshold={1} mipmapBlur intensity={1.2} radius={0.6} />
                        </EffectComposer>
                        {/* BackgroundLaser is authored Y-up; this wrapper maps its local +Y onto machine +Z */}
                        <group rotation={[Math.PI / 2, 0, 0]}>
                            <group position={[bed.centerX, 1000, -bed.centerY - 1000]}>
                                <BackgroundLaser delay={0} spawnMode="vertical" height={6000} xRange={1000} zRange={100} particleSize={9} />
                                <BackgroundLaser delay={3.5} spawnMode="vertical" height={6000} xRange={1000} zRange={100} particleSize={9} />
                            </group>
                            <group position={[bed.centerX, -20, -bed.centerY]}>
                                <BackgroundLaser delay={1.5} spawnMode="flat" xRange={bed.width} zRange={bed.height} />
                                <BackgroundLaser delay={5.0} spawnMode="flat" xRange={bed.width} zRange={bed.height} />
                            </group>
                        </group>
                    </>
                )}

                <MachineBed bed={bed} visible={machineSettings?.workbench?.showWorkbench !== false} />
                {/* Mill jobs are drawn relative to work Z0 (stock top or bottom), so the head follows the same offset */}
                <MachineHead x={machinePos.x} y={machinePos.y} z={machinePos.z + workZ0} power={spindle} />

                <Suspense fallback={null}>
                    <group position={[0, 0, objectLift]} visible={!mill?.sim || !showMill}>
                        {objects?.map(obj => (
                            <ObjectRenderer
                                key={obj.id}
                                ref={(el) => { objectRefs.current[obj.id] = el; }}
                                object={obj}
                                selected={!!obj.selected}
                                onSelect={() => onSelectObject && onSelectObject(obj.id)}
                            />
                        ))}
                    </group>
                </Suspense>

                {selectedObject && objectRefs.current[selectedObject.id] && !(showMill && mill?.sim) && (
                    <TransformControls
                        object={objectRefs.current[selectedObject.id]!}
                        mode={transformMode}
                        // 2D artwork: move in XY, rotate about Z, scale in XY only
                        showZ={transformMode === 'rotate'}
                        showX={transformMode !== 'rotate'}
                        showY={transformMode !== 'rotate'}
                        onMouseUp={commitTransform}
                    />
                )}

                {showMill && mill && <MillScene {...mill} />}

                <GCodeViewer
                    gcode={gcode}
                    progressLine={progressLine}
                    zOffset={gcodeIsMill && mill ? mill.stock.thickness - gcodeTopZ : 0}
                    colorBy={gcodeIsMill ? 'depth' : 'power'}
                    depthTop={gcodeTopZ}
                    visible={!(showMill && mill?.sim)}
                />

                <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
                    <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#0f172a" />
                </GizmoHelper>
            </Canvas>

            {/* View toolbar */}
            <div className="absolute top-3 left-3 flex flex-col gap-2 pointer-events-auto">
                <div className="flex gap-1 bg-slate-950/70 backdrop-blur p-1 rounded-lg border border-white/10 shadow-lg">
                    {viewButton('3d', '3D', Box, '3D perspective view')}
                    {viewButton('top', 'TOP', Square, '2D top view (XY plane, Z towards you)')}
                    {viewButton('front', 'FRONT', RectangleHorizontal, 'Front view (XZ)')}
                    <button
                        title="Fit bed in view"
                        onClick={() => setViewNonce(n => n + 1)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-slate-300 hover:bg-white/10 hover:text-white"
                    >
                        <Maximize size={14} /> FIT
                    </button>
                </div>

                {selectedObject && (
                    <div className="flex gap-1 bg-slate-950/70 backdrop-blur p-1 rounded-lg border border-white/10 shadow-lg w-fit">
                        {(['translate', 'rotate', 'scale'] as const).map(m => (
                            <button
                                key={m}
                                title={`${m[0].toUpperCase() + m.slice(1)} (${m[0].toUpperCase()})`}
                                onClick={() => setTransformMode(m)}
                                className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold uppercase ${transformMode === m ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/10'}`}
                            >
                                {m === 'translate' ? 'Move' : m}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Position readout + legend */}
            <div className="absolute bottom-3 left-3 pointer-events-none flex flex-col gap-1.5">
                <div className="font-mono text-xs bg-slate-950/70 backdrop-blur px-3 py-2 rounded-lg border border-white/10 shadow-lg flex gap-4">
                    <span><span className="text-red-400 font-bold">X</span> {machinePos.x.toFixed(2)}</span>
                    <span><span className="text-green-400 font-bold">Y</span> {machinePos.y.toFixed(2)}</span>
                    <span><span className="text-blue-400 font-bold">Z</span> {machinePos.z.toFixed(2)}</span>
                </div>
                <div className="text-[10px] text-slate-400 bg-slate-950/60 px-2 py-1 rounded border border-white/5 flex items-center gap-3">
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-red-500" /> {gcodeIsMill ? 'cut (yellow shallow → red deep)' : 'cut'}</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 border-t border-dashed border-sky-500" /> travel</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-emerald-500" /> done</span>
                    <span className="hidden md:inline">· Left-drag orbit · Right-drag pan · Wheel zoom</span>
                    {laserBeamEnabled && <Sparkles size={10} className="text-cyan-400" />}
                </div>
            </div>
        </div>
    );
};
export default VisualizerScene;
