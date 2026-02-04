import { useState, useEffect } from 'react';
import { Save, Upload, Download, RefreshCw, LayoutTemplate, Box, ArrowLeftRight, Eye, Unlock, Settings as SettingsIcon } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { MachineSettings, AxisSettings, WorkbenchSettings } from '../types';

// ... (keep MoveIcon)

// Fix missing destructuring
function AxisVisualizer({ settings, onUpdateOrigin, updateAxis }: { settings: MachineSettings, onUpdateOrigin: (o: any) => void, updateAxis?: any }) {
    const w = settings.workbench.width;
    const h = settings.workbench.height;
    const origin = settings.workbench.origin;

    // visual bed dimensions
    const bedW = w;
    const bedH = h;

    return (
        <Canvas>
            <PerspectiveCamera makeDefault position={[0, 400, 400]} fov={45} />
            <OrbitControls enableZoom={true} enablePan={true} maxPolarAngle={Math.PI / 2} target={[0, 0, 0]} />
            <ambientLight intensity={0.5} />
            <pointLight position={[100, 100, 100]} />

            {/* Bed centered at 0,0 for easier viewing */}
            {/* Actual Machine Coordinates relative to bed depend on origin */}
            <SettingsScene
                w={w} h={h}
                origin={origin}
                settings={settings}
                onUpdateOrigin={onUpdateOrigin}
                updateAxis={updateAxis}
            />
        </Canvas>
    )
}

function SettingsScene({ w, h, origin, settings, onUpdateOrigin, updateAxis }: { w: number, h: number, origin: string, settings: MachineSettings, onUpdateOrigin: (o: any) => void, updateAxis: any }) {
    // Bed Mesh (Centered)
    // We visualize the Bed as a static object in the center of the viewer
    // We move the "Origin Marker" to the correct corner relative to this bed

    // Corners relative to center (0,0)
    // Corners relative to center (0,0)
    const BL = [-w / 2, -h / 2, 0];
    const TL = [-w / 2, h / 2, 0];
    const TR = [w / 2, h / 2, 0];
    const BR = [w / 2, -h / 2, 0];

    // Current Origin Position
    let originPos = BL;
    // Default Directions: ALWAYS Positive (Right/Up) unless settings.reversed is true
    // We do NOT flip direction based on origin position anymore, per user request.
    const xDir = 1;
    const yDir = 1;
    const zDir = 1;

    if (origin === 'top-left') {
        originPos = TL;
    } else if (origin === 'top-right') {
        originPos = TR;
    } else if (origin === 'bottom-right') {
        originPos = BR;
    } else {
        // bottom-left (default)
        originPos = BL;
    }

    // Apply "Reversed" overrides
    // If Logic is Reversed, the positive movement is opposite to standard
    const xRev = settings.axes.x.reversed ? -1 : 1;
    const yRev = settings.axes.y.reversed ? -1 : 1;
    const zRev = settings.axes.z.reversed ? -1 : 1;

    // Final Directions
    const xVec = xDir * xRev;
    const yVec = yDir * yRev;
    const zVec = zDir * zRev;

    // Homing Positions
    const xHome = settings.axes.x.homingPos || 'min';
    const yHome = settings.axes.y.homingPos || 'min';
    // const zHome = settings.axes.z.homingPos || 'max'; // Z Visualizer Removed per user request

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}> {/* Flat top-down view (Plan XY) */}
            {/* Bed Plate */}
            <mesh receiveShadow>
                <boxGeometry args={[w, h, 2]} />
                <meshStandardMaterial color="#e5e7eb" roughness={0.5} />
            </mesh>
            <gridHelper args={[Math.max(w, h), 10]} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 1.1]} />

            {/* Clickable Origin Selectors */}
            <OriginSelector pos={BL} active={origin === 'bottom-left'} onClick={() => onUpdateOrigin('bottom-left')} label="BL" />
            <OriginSelector pos={TL} active={origin === 'top-left'} onClick={() => onUpdateOrigin('top-left')} label="TL" />
            <OriginSelector pos={TR} active={origin === 'top-right'} onClick={() => onUpdateOrigin('top-right')} label="TR" />
            <OriginSelector pos={BR} active={origin === 'bottom-right'} onClick={() => onUpdateOrigin('bottom-right')} label="BR" />


            {/* The BIG Axis Marker at CURRENT Origin */}
            <group position={new THREE.Vector3(...originPos).add(new THREE.Vector3(0, 0, 2))}>
                <AxisArrow dir={[xVec, 0, 0]} color="red" label="X+" length={40} />
                <AxisArrow dir={[0, yVec, 0]} color="green" label="Y+" length={40} />
                <AxisArrow dir={[0, 0, zVec]} color="blue" label="Z+" length={40} />
                <mesh>
                    <sphereGeometry args={[3]} />
                    <meshStandardMaterial color="white" />
                </mesh>
            </group>

            {/* Homing Selectors */}
            {/* Homing Selectors - Moved to Edge Centers */}
            {/* X Axis */}
            <HomingSelector
                pos={[-w / 2 - 30, 0, 0]} // Left Edge Center
                active={xHome === 'min'}
                onClick={() => updateAxis('x', 'homingPos', 'min')}
                color="red"
                label={settings.axes.x.reversed ? "X+" : "X-"}
            />
            <HomingSelector
                pos={[w / 2 + 30, 0, 0]} // Right Edge Center
                active={xHome === 'max'}
                onClick={() => updateAxis('x', 'homingPos', 'max')}
                color="red"
                label={settings.axes.x.reversed ? "X-" : "X+"}
            />

            {/* Y Axis */}
            <HomingSelector
                pos={[0, -h / 2 - 30, 0]} // Bottom Edge Center
                active={yHome === 'min'}
                onClick={() => updateAxis('y', 'homingPos', 'min')}
                color="green"
                label={settings.axes.y.reversed ? "Y+" : "Y-"}
            />
            <HomingSelector
                pos={[0, h / 2 + 30, 0]} // Top Edge Center
                active={yHome === 'max'}
                onClick={() => updateAxis('y', 'homingPos', 'max')}
                color="green"
                label={settings.axes.y.reversed ? "Y-" : "Y+"}
            />

            {/* Z Axis Visualizer REMOVED as requested */}
            {/* <SettingsZProbe ... /> */}

        </group>
    );
}

function HomingSelector({ pos, active, onClick, label, color }: any) {
    return (
        <group position={pos}>
            <mesh onClick={(e) => { e.stopPropagation(); onClick(); }}>
                <boxGeometry args={[10, 10, 5]} />
                <meshStandardMaterial color={active ? color : "#334155"} emissive={active ? color : "#000"} emissiveIntensity={0.5} />
            </mesh>
            {active && (
                <Html center position={[0, -15, 0]}>
                    <div className="bg-black/80 text-white text-[10px] px-1 rounded whitespace-nowrap">HOME</div>
                </Html>
            )}
            <Html center position={[0, 15, 0]}>
                <div className={`text-[10px] font-bold ${active ? 'opacity-100' : 'opacity-50'} text-white`}>{label}</div>
            </Html>
        </group>
    )
}

function SettingsZProbe({ pos, height, active, onToggle }: any) {
    // Renders a vertical bar representing Z axis limit
    // active = 'min' or 'max'
    return (
        <group position={pos}>
            {/* Vertical Guide Line */}
            <mesh position={[0, 0, height / 2]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[1, 1, height, 8]} />
                <meshBasicMaterial color="blue" opacity={0.3} transparent />
            </mesh>

            {/* Z-MIN (Bottom) */}
            <group position={[0, 0, 5]}>
                <mesh onClick={(e) => { e.stopPropagation(); onToggle('min'); }}>
                    <boxGeometry args={[10, 10, 5]} />
                    <meshStandardMaterial color={active === 'min' ? "blue" : "#334155"} emissive={active === 'min' ? "blue" : "#000"} emissiveIntensity={0.5} />
                </mesh>
                <Html center position={[15, 0, 0]}>
                    <div className="text-[10px] text-blue-200 font-bold">Z-MIN</div>
                </Html>
            </group>

            {/* Z-MAX (Top) */}
            <group position={[0, 0, height]}>
                <mesh onClick={(e) => { e.stopPropagation(); onToggle('max'); }}>
                    <boxGeometry args={[10, 10, 5]} />
                    <meshStandardMaterial color={active === 'max' ? "blue" : "#334155"} emissive={active === 'max' ? "blue" : "#000"} emissiveIntensity={0.5} />
                </mesh>
                <Html center position={[15, 0, 0]}>
                    <div className="text-[10px] text-blue-200 font-bold">Z-MAX</div>
                </Html>
                {active === 'max' && (
                    <Html center position={[0, 15, 0]}>
                        <div className="bg-black/80 text-white text-[10px] px-1 rounded">HOME</div>
                    </Html>
                )}
            </group>
            {active === 'min' && (
                <Html center position={[0, 15, 5]}>
                    <div className="bg-black/80 text-white text-[10px] px-1 rounded">HOME</div>
                </Html>
            )}
        </group>
    )
}

function OriginSelector({ pos, active, onClick, label }: any) {
    return (
        <group position={pos}>
            <mesh onClick={(e) => { e.stopPropagation(); onClick(); }}>
                <sphereGeometry args={[5]} />
                <meshStandardMaterial color={active ? "#06b6d4" : "#475569"} />
            </mesh>
            <Html center position={[0, 0, 10]}>
                <div
                    className={`text-xs font-bold cursor-pointer ${active ? 'text-cyan-400' : 'text-gray-500'} select-none`}
                    onClick={onClick}
                >
                    {label}
                </div>
            </Html>
        </group>
    )
}

function AxisArrow({ dir, color, label, length }: any) {
    // dir is vector [x, y, z]
    // Create quaternion to rotate Cylinder(0,1,0) to dir
    const direction = new THREE.Vector3(...dir).normalize();
    // const origin = new THREE.Vector3(0, 0, 0);

    // We can just use ArrowHelper primitive or construct custom thick arrow
    // ArrowHelper lines are thin. User wants "2 times bigger". 
    // Let's build custom mesh.

    // Rotate Up (0,1,0) to target direction
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);

    return (
        <group quaternion={quaternion}>
            <mesh position={[0, length / 2, 0]}>
                <cylinderGeometry args={[3, 3, length, 12]} />
                <meshStandardMaterial color={color} />
            </mesh>
            <mesh position={[0, length + 2, 0]}>
                <coneGeometry args={[6, 12, 16]} />
                <meshStandardMaterial color={color} />
            </mesh>

            {/* Text Label */}
            <Html position={[0, length + 10, 0]} center>
                <div style={{ color: color, fontWeight: 'bold', fontSize: '10px' }}>{label}</div>
            </Html>
        </group>
    )

}

interface MachineSettingsPanelProps {
    status: any; // Using any for status to avoid circular dependency or complex type import for now
    laserBeamEnabled: boolean;
    setLaserBeamEnabled: (enabled: boolean) => void;
    onSettingsChange?: (settings: MachineSettings) => void;
}

const API_URL = import.meta.env.DEV ? 'http://localhost:3000' : '';

export default function MachineSettingsPanel({ status, laserBeamEnabled, setLaserBeamEnabled, onSettingsChange }: MachineSettingsPanelProps) {
    const [settings, setSettings] = useState<MachineSettings | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<'app' | 'hardware'>('app');

    // Hardware Params State
    const [hwParams, setHwParams] = useState<any>({});
    const [syncingGrbl, setSyncingGrbl] = useState(false);

    useEffect(() => {
        fetchSettings();
    }, []);

    // Load initial HW params from status if available
    useEffect(() => {
        if (status?.grblSettings) {
            setHwParams((prev: any) => ({ ...prev, ...status.grblSettings }));
        }
    }, [status?.grblSettings]);

    // Emit settings changes to parent for live preview
    useEffect(() => {
        if (settings && onSettingsChange) {
            onSettingsChange(settings);
        }
    }, [settings, onSettingsChange]);

    const fetchSettings = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/settings/machine`);
            const data = await res.json();
            setSettings(data);
        } catch (error) {
            console.error('Failed to fetch settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!settings) return;
        setSaving(true);
        try {
            await fetch(`${API_URL}/api/settings/machine`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
        } catch (error) {
            console.error('Failed to save settings:', error);
        } finally {
            setSaving(false);
        }
    };

    const updateWorkbench = (key: keyof WorkbenchSettings, value: any) => {
        if (!settings) return;
        setSettings({
            ...settings,
            workbench: { ...settings.workbench, [key]: value }
        });
    };

    const updateAxis = (axis: 'x' | 'y' | 'z', key: keyof AxisSettings, value: any) => {
        if (!settings) return;
        setSettings({
            ...settings,
            axes: {
                ...settings.axes,
                [axis]: { ...settings.axes[axis], [key]: value }
            }
        });
    };

    const [updateInfo, setUpdateInfo] = useState<{ available: boolean, currentVersion: string, remoteVersion: string } | null>(null);
    const [checkingUpdate, setCheckingUpdate] = useState(false);

    const checkUpdates = async () => {
        setCheckingUpdate(true);
        try {
            const res = await fetch(`${API_URL}/api/system/update/check`);
            const data = await res.json();
            setUpdateInfo(data);
        } catch (e) {
            console.error(e);
        } finally {
            setCheckingUpdate(false);
        }
    };

    const handleUpdate = async () => {
        if (!confirm("This will update the software and restart the server. Continue?")) return;
        try {
            await fetch(`${API_URL}/api/system/update/apply`, { method: 'POST' });
            alert("Update started. Server is restarting... Page will reload in 10s.");
            setTimeout(() => window.location.reload(), 10000);
        } catch (e) {
            alert("Update failed.");
        }
    };

    const sendGcode = async (cmd: string) => {
        try {
            await fetch(`${API_URL}/command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gcode: cmd })
            });
        } catch (e) {
            console.error("Command failed", e);
        }
    }

    const handleImportGrbl = async () => {
        setSyncingGrbl(true);
        // 1. Request Settings
        await sendGcode('$$');

        // 2. Wait a moment for status to update (naive approach, better would be to wait for specific event)
        setTimeout(() => {
            if (status.grblSettings) {
                const maxX = status.grblSettings['130'] || 300;
                const maxY = status.grblSettings['131'] || 200;
                const maxZ = status.grblSettings['132'] || 50;

                if (settings) {
                    const newSettings = { ...settings };
                    newSettings.workbench.width = maxX;
                    newSettings.workbench.height = maxY;
                    newSettings.workbench.depth = maxZ;
                    newSettings.axes.x.max = maxX;
                    newSettings.axes.y.max = maxY;
                    newSettings.axes.z.max = maxZ;
                    setSettings(newSettings);
                    alert(`Imported Dimensions: ${maxX}x${maxY}x${maxZ}`);
                }
            } else {
                alert("No GRBL settings received. Is machine connected?");
            }
            setSyncingGrbl(false);
        }, 1500);
    };

    const handleImportKlipper = () => alert("Import from Klipper - Coming Soon");

    const updateHwParam = (id: string, val: string) => {
        setHwParams({ ...hwParams, [id]: val });
    }

    const uploadHwParam = async (id: string) => {
        const val = hwParams[id];
        if (val === undefined) return;
        await sendGcode(`$${id}=${val}`);
        // Refresh
        setTimeout(() => sendGcode('$$'), 500);
    }

    if (loading || !settings) return <div className="p-4 text-gray-400">Loading settings...</div>;

    return (
        <div className="p-4 space-y-6 text-sm">

            {/* New Tabs Header */}
            <div className="flex space-x-2 border-b border-white/10 pb-2 mb-4">
                <button
                    onClick={() => setActiveTab('app')}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${activeTab === 'app' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                    App Settings
                </button>
                <button
                    onClick={() => setActiveTab('hardware')}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${activeTab === 'hardware' ? 'bg-orange-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                    Hardware Parameters
                </button>
            </div>


            {activeTab === 'app' && (
                <>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <LayoutTemplate size={20} className="text-cyan-400" />
                            Machine Setup
                        </h3>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1 rounded flex items-center gap-2 disabled:opacity-50"
                        >
                            <Save size={16} />
                            {saving ? 'Saving...' : 'Save'}
                        </button>
                    </div>

                    {/* Workbench Dimensions */}
                    <section className="bg-slate-800/50 p-4 rounded-lg border border-white/10 space-y-4">
                        <h4 className="text-md font-semibold text-gray-200 flex items-center gap-2">
                            <Box size={16} /> Workbench Area
                        </h4>
                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Width (X)</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={settings.workbench.width}
                                        onChange={e => updateWorkbench('width', parseFloat(e.target.value))}
                                        className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-white text-right pr-6"
                                    />
                                    <span className="absolute right-2 top-1 text-gray-500 text-xs">mm</span>
                                </div>
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Height (Y)</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={settings.workbench.height}
                                        onChange={e => updateWorkbench('height', parseFloat(e.target.value))}
                                        className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-white text-right pr-6"
                                    />
                                    <span className="absolute right-2 top-1 text-gray-500 text-xs">mm</span>
                                </div>
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Depth (Z)</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={settings.workbench.depth}
                                        onChange={e => updateWorkbench('depth', parseFloat(e.target.value))}
                                        className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-white text-right pr-6"
                                    />
                                    <span className="absolute right-2 top-1 text-gray-500 text-xs">mm</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                            <span className="text-gray-400">Show in Visualizer</span>
                            <input
                                type="checkbox"
                                checked={settings.workbench.showWorkbench}
                                onChange={e => updateWorkbench('showWorkbench', e.target.checked)}
                                className="accent-cyan-500"
                            />
                        </div>
                    </section>

                    {/* Import / Export - moved up for logical flow */}
                    <section className="bg-slate-800/50 p-4 rounded-lg border border-white/10 space-y-4">
                        <h4 className="text-md font-semibold text-gray-200">Data Synchronization</h4>
                        <div className="flex gap-2">
                            <button
                                onClick={handleImportGrbl}
                                disabled={syncingGrbl}
                                className="flex-1 bg-white/5 hover:bg-white/10 p-2 rounded text-xs flex flex-col items-center gap-1 disabled:opacity-50"
                            >
                                <RefreshCw size={16} className={`text-blue-400 ${syncingGrbl ? 'animate-spin' : ''}`} />
                                <span>GRBL Import (Sync Size)</span>
                            </button>
                            <button onClick={handleImportKlipper} className="flex-1 bg-white/5 hover:bg-white/10 p-2 rounded text-xs flex flex-col items-center gap-1">
                                <RefreshCw size={16} className="text-orange-400" />
                                <span>Klipper Import</span>
                            </button>
                        </div>
                    </section>

                    {/* Axis Configuration & Visualizer */}
                    <section className="bg-slate-800/50 p-4 rounded-lg border border-white/10 space-y-4">
                        <h4 className="text-md font-semibold text-gray-200 flex items-center gap-2">
                            <MoveIcon /> Axis Configuration
                        </h4>

                        {/* Visualizer Mockup (Simple SVG) */}
                        <div className="w-full aspect-video bg-slate-900 rounded border border-white/5 relative flex items-center justify-center overflow-hidden">
                            <AxisVisualizer settings={settings} onUpdateOrigin={(o) => updateWorkbench('origin', o)} updateAxis={updateAxis} />
                        </div>

                        <div className="space-y-2">
                            {/* Header */}
                            <div className="flex items-center justify-between text-xs text-gray-500 mb-2 border-b border-white/5 pb-1">
                                <span>Axis</span>
                                <span>Offset from Marker (mm)</span>
                                <span>Direction</span>
                            </div>

                            {/* X Axis */}
                            <div className="flex items-center justify-between bg-white/5 p-2 rounded">
                                <div className="flex items-center gap-2">
                                    <span className="text-red-500 font-bold w-4">X</span>
                                    <input
                                        type="number"
                                        value={settings.axes.x.offset || 0}
                                        onChange={e => updateAxis('x', 'offset', parseFloat(e.target.value))}
                                        className="w-16 bg-transparent border-b border-white/20 text-white text-xs text-center focus:border-cyan-500 outline-none"
                                        placeholder="0"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={settings.axes.x.homingPos || 'min'}
                                        onChange={e => updateAxis('x', 'homingPos', e.target.value)}
                                        className="bg-transparent text-xs text-gray-400 border-b border-gray-600 outline-none hover:text-white"
                                    >
                                        <option value="min">Home: Min</option>
                                        <option value="max">Home: Max</option>
                                    </select>
                                    <label className="text-xs text-gray-400 flex items-center gap-2 cursor-pointer hover:text-white" title="Invert Positive Direction">
                                        <input
                                            type="checkbox"
                                            checked={settings.axes.x.reversed}
                                            onChange={e => updateAxis('x', 'reversed', e.target.checked)}
                                            className="accent-red-500"
                                        />
                                        Reverse +Dir
                                    </label>
                                </div>
                            </div>

                            {/* Y Axis */}
                            <div className="flex items-center justify-between bg-white/5 p-2 rounded">
                                <div className="flex items-center gap-2">
                                    <span className="text-green-500 font-bold w-4">Y</span>
                                    <input
                                        type="number"
                                        value={settings.axes.y.offset || 0}
                                        onChange={e => updateAxis('y', 'offset', parseFloat(e.target.value))}
                                        className="w-16 bg-transparent border-b border-white/20 text-white text-xs text-center focus:border-cyan-500 outline-none"
                                        placeholder="0"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={settings.axes.y.homingPos || 'min'}
                                        onChange={e => updateAxis('y', 'homingPos', e.target.value)}
                                        className="bg-transparent text-xs text-gray-400 border-b border-gray-600 outline-none hover:text-white"
                                    >
                                        <option value="min">Home: Min</option>
                                        <option value="max">Home: Max</option>
                                    </select>
                                    <label className="text-xs text-gray-400 flex items-center gap-2 cursor-pointer hover:text-white" title="Invert Positive Direction">
                                        <input
                                            type="checkbox"
                                            checked={settings.axes.y.reversed}
                                            onChange={e => updateAxis('y', 'reversed', e.target.checked)}
                                            className="accent-green-500"
                                        />
                                        Reverse +Dir
                                    </label>
                                </div>
                            </div>

                            {/* Z Axis */}
                            <div className="flex items-center justify-between bg-white/5 p-2 rounded">
                                <div className="flex items-center gap-2">
                                    <span className="text-blue-500 font-bold w-4">Z</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-400 text-xs w-12">{settings.axes.z.max}mm</span>
                                        <label className="text-[10px] text-gray-500 flex items-center gap-1">
                                            <input
                                                type="checkbox"
                                                checked={settings.axes.z.visible}
                                                onChange={e => updateAxis('z', 'visible', e.target.checked)}
                                                className="accent-gray-500"
                                            />
                                            Enable
                                        </label>
                                    </div>
                                </div>
                                {settings.axes.z.visible && (
                                    <div className="flex items-center gap-4">
                                        <input
                                            type="number"
                                            value={settings.axes.z.offset || 0}
                                            onChange={e => updateAxis('z', 'offset', parseFloat(e.target.value))}
                                            className="w-12 bg-transparent border-b border-white/20 text-white text-xs text-center focus:border-cyan-500 outline-none"
                                            placeholder="Off"
                                        />
                                        <label className="text-xs text-gray-400 flex items-center gap-2 cursor-pointer hover:text-white" title="Invert Positive Direction">
                                            <input
                                                type="checkbox"
                                                checked={settings.axes.z.reversed}
                                                onChange={e => updateAxis('z', 'reversed', e.target.checked)}
                                                className="accent-blue-500"
                                            />
                                            Reverse +Dir
                                        </label>
                                    </div>
                                )}
                            </div>
                            {/* Z Homing Buttons Row */}
                            {settings.axes.z.visible && (
                                <div className="flex gap-2 mt-1 w-full pl-8 pr-2">
                                    <button
                                        onClick={() => updateAxis('z', 'homingPos', 'max')}
                                        className={`flex-1 py-1 text-[10px] rounded border border-white/10 ${(!settings.axes.z.homingPos || settings.axes.z.homingPos === 'max') ? 'bg-blue-600/50 text-white border-blue-500' : 'bg-transparent text-gray-500 hover:text-gray-300'}`}
                                        title="Home to Top (Max Z)"
                                    >
                                        Home Top
                                    </button>
                                    <button
                                        onClick={() => updateAxis('z', 'homingPos', 'min')}
                                        className={`flex-1 py-1 text-[10px] rounded border border-white/10 ${settings.axes.z.homingPos === 'min' ? 'bg-blue-600/50 text-white border-blue-500' : 'bg-transparent text-gray-500 hover:text-gray-300'}`}
                                        title="Home to Bottom (Min Z)"
                                    >
                                        Home Bottom
                                    </button>
                                </div>
                            )}
                        </div>
                    </section>
                </>
            )}

            {activeTab === 'hardware' && (
                <div className="space-y-4">
                    <p className="text-xs text-orange-400 bg-orange-900/20 p-2 rounded border border-orange-900/50">
                        ⚠ Changes in this tab are written directly to the machine firmware (EEPROM). Proceed with caution.
                    </p>

                    {/* Machine Controls - Homing, Unlock */}
                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => sendGcode('$H')} className="bg-blue-600 hover:bg-blue-500 text-white p-3 rounded flex items-center justify-center gap-2">
                            <RefreshCw size={18} /> Home Machine ($H)
                        </button>
                        <button onClick={() => sendGcode('$X')} className="bg-red-600 hover:bg-red-500 text-white p-3 rounded flex items-center justify-center gap-2">
                            <Unlock size={18} /> Unlock / Reset ($X)
                        </button>
                    </div>

                    <div className="bg-slate-800/50 p-4 rounded-lg border border-white/10">
                        <div className="flex justify-between items-center mb-4">
                            <h4 className="text-md font-semibold text-gray-200 flex items-center gap-2">
                                <SettingsIcon size={16} /> GRBL Parameters
                            </h4>
                            <button onClick={() => sendGcode('$$')} className="text-xs text-cyan-400 hover:underline">
                                Refresh ($$)
                            </button>
                        </div>

                        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                            {/* Max Rate */}
                            <div className="space-y-2">
                                <h5 className="text-xs font-bold text-gray-500 uppercase">Max Rate (mm/min)</h5>
                                {[110, 111, 112].map((id, idx) => (
                                    <div key={id} className="flex items-center justify-between text-xs bg-white/5 p-2 rounded">
                                        <span className="text-gray-300 w-24">{'XYZ'[idx]} (${id})</span>
                                        <input
                                            type="number"
                                            value={hwParams[id] ?? ''}
                                            onChange={(e) => updateHwParam(id.toString(), e.target.value)}
                                            className="w-20 bg-slate-900 border border-white/10 rounded px-2 py-1 text-right text-white"
                                        />
                                        <button onClick={() => uploadHwParam(id.toString())} className="text-cyan-400 hover:text-cyan-300 ml-2">
                                            <Upload size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* Acceleration */}
                            <div className="space-y-2">
                                <h5 className="text-xs font-bold text-gray-500 uppercase">Acceleration (mm/sec²)</h5>
                                {[120, 121, 122].map((id, idx) => (
                                    <div key={id} className="flex items-center justify-between text-xs bg-white/5 p-2 rounded">
                                        <span className="text-gray-300 w-24">{'XYZ'[idx]} (${id})</span>
                                        <input
                                            type="number"
                                            value={hwParams[id] ?? ''}
                                            onChange={(e) => updateHwParam(id.toString(), e.target.value)}
                                            className="w-20 bg-slate-900 border border-white/10 rounded px-2 py-1 text-right text-white"
                                        />
                                        <button onClick={() => uploadHwParam(id.toString())} className="text-cyan-400 hover:text-cyan-300 ml-2">
                                            <Upload size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* Max Travel */}
                            <div className="space-y-2">
                                <h5 className="text-xs font-bold text-gray-500 uppercase">Max Travel (mm)</h5>
                                {[130, 131, 132].map((id, idx) => (
                                    <div key={id} className="flex items-center justify-between text-xs bg-white/5 p-2 rounded">
                                        <span className="text-gray-300 w-24">{'XYZ'[idx]} (${id})</span>
                                        <input
                                            type="number"
                                            value={hwParams[id] ?? ''}
                                            onChange={(e) => updateHwParam(id.toString(), e.target.value)}
                                            className="w-20 bg-slate-900 border border-white/10 rounded px-2 py-1 text-right text-white"
                                        />
                                        <button onClick={() => uploadHwParam(id.toString())} className="text-cyan-400 hover:text-cyan-300 ml-2">
                                            <Upload size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>
                </div>
            )}


            {/* Visualizer Settings */}
            <section className="bg-slate-800/50 p-4 rounded-lg border border-white/10 space-y-4">
                <h4 className="text-md font-semibold text-gray-200 flex items-center gap-2">
                    <Eye size={16} /> App Preferences
                </h4>
                <div className="flex items-center justify-between">
                    <span className="text-gray-400">Background Cosmetic Laser</span>
                    <button
                        onClick={() => setLaserBeamEnabled(!laserBeamEnabled)}
                        className={`w-10 h-5 rounded-full transition-colors relative ${laserBeamEnabled ? 'bg-cyan-500' : 'bg-slate-700'}`}
                    >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${laserBeamEnabled ? 'left-5.5' : 'left-0.5'}`} />
                    </button>
                </div>
            </section>

            {/* System Update */}
            <section className="bg-slate-800/50 p-4 rounded-lg border border-white/10 space-y-4">
                <h4 className="text-md font-semibold text-gray-200 flex items-center gap-2">
                    <RefreshCw size={16} /> System Updates
                </h4>
                <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-xs">
                        Current Ver: {updateInfo?.currentVersion || 'Unknown'}
                    </span>
                    {updateInfo?.available ? (
                        <button onClick={handleUpdate} className="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-xs flex items-center gap-2">
                            <Download size={14} /> Update to {updateInfo.remoteVersion}
                        </button>
                    ) : (
                        <button onClick={checkUpdates} className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1 rounded text-xs flex items-center gap-2">
                            <RefreshCw size={14} className={checkingUpdate ? "animate-spin" : ""} /> {updateInfo ? 'Up to date' : 'Check for Updates'}
                        </button>
                    )}
                </div>
            </section>

            {/* System Info */}
            <div className="bg-slate-800/50 p-4 rounded-lg border border-white/10 opacity-75">
                <h3 className="text-md font-semibold text-white mb-4">System Info</h3>
                <div className="space-y-2 text-xs text-gray-400">
                    <div className="flex justify-between">
                        <span>Server URL:</span>
                        <span className="font-mono text-cyan-400 overflow-hidden text-ellipsis ml-2">{(status as any).ip || window.location.host}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Client Version:</span>
                        <span className="font-mono">v1.1.0 (Settings Upd)</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Mode:</span>
                        <span className="font-mono">{status.state === 'Disconnected' ? 'Offline' : 'Online'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function MoveIcon() {
    return <ArrowLeftRight size={16} />;
}



