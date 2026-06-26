import { useState, useEffect, useCallback } from 'react';
import { ConnectionPanel } from './components/ConnectionPanel';
import { ControlPanel } from './components/ControlPanel';
import CamPanel from './components/CamPanel';
import Terminal from './components/Terminal';
import MacroPanel from './components/MacroPanel';
import VisualizerScene from './components/Visualizer/VisualizerScene';
import type { MachineStatus, DetectedPath, MillingOperation, ToolpathPolygon } from './types';
import { Activity } from 'lucide-react';

import { Sidebar } from './components/Sidebar';
import { BackgroundFX } from './components/BackgroundFX';
import MachineSettingsPanel from './components/MachineSettingsPanel';
import { JobWizardModal } from './components/cnc/JobWizardModal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function App() {
  const [status, setStatus] = useState<MachineStatus>({
    state: 'Disconnected',
    pos: { x: 0, y: 0, z: 0 },
    feedrate: 0,
    spindle: 0,
    logs: []
  });

  const [gcode, setGcode] = useState<string[]>([]);
  const handleGcodeGenerated = (generated: string) => {
    setGcode(generated.split('\n'));
    setActiveTab('gcode'); // Auto-switch to GCode view
  };

  // Live Preview Settings (overrides server status while editing)
  const [draftSettings, setDraftSettings] = useState<any>(null); // Type as any or MachineSettings if imported

  // const [lastPing, setLastPing] = useState<Date>(new Date());

  // ...
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Safety: Ensure pos exists if server returns partial status (e.g. Disconnected)
      setStatus(prev => ({
        ...prev,
        ...data,
        pos: data.pos || prev.pos || { x: 0, y: 0, z: 0 }
      }));
      setConnectionError(null);
    } catch (e: any) {
      console.error("Fetch Status Error:", e);
      setConnectionError(e.message || "Connection Failed");
    }
  }, []);

  // ...



  useEffect(() => {
    fetchStatus(); // Immediate fetch on mount
    const timer = setInterval(fetchStatus, 200); // 200ms poll as requested
    return () => clearInterval(timer);
  }, [fetchStatus]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleConnect = async (type: 'grbl' | 'klipper', config: any) => {
    try {
      await fetch(`${API_URL}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, ...config })
      });
      fetchStatus();
    } catch {
      alert('Connection failed');
    }
  };

  const handleDisconnect = async () => {
    // Implement disconnect
  };

  const handleJog = async (axis: 'x' | 'y' | 'z', dist: number, feedrate: number) => {
    try {
      await fetch(`${API_URL}/jog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ axis, dist, feedrate })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleCommand = async (gcode: string) => {
    try {
      // alert(`[DEBUG] Sending: ${gcode} to ${API_URL}/command`); // Debug Alert
      const res = await fetch(`${API_URL}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gcode })
      });
      if (!res.ok) {
        const txt = await res.text();
        alert(`[ERROR] Command Failed: ${res.status} ${txt}`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`[ERROR] Network Error: ${e.message}`);
    }
  };

  const executeJob = async (setupCmds: string[], mode: 'absolute' | 'relative') => {
      try {
          const res = await fetch(`${API_URL}/cam/stream-job`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  setupCommands: setupCmds,
                  gcode: gcode
              })
          });
          if (!res.ok) {
              const txt = await res.text();
              alert(`[ERROR] Failed to start stream: ${res.status} ${txt}`);
          }
      } catch (e: any) {
          console.error(e);
          alert(`[ERROR] Network Error: ${e.message}`);
      }
  };

  const handleProbe = async (options: unknown) => {
    try {
      await fetch(`${API_URL}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options)
      });
    } catch {
      alert('Probe Failed to Start');
    }
  };

  const handleLaserTest = async (powerPct: number, duration: number) => {
    const sVal = Math.floor((powerPct / 100) * 1000);
    const cmd = sVal > 0 ? `M3 S${sVal}` : 'M5';
    // alert(`[DEBUG] Fire Laser: Power=${powerPct}% S=${sVal} Cmd=${cmd}`);
    handleCommand(cmd);

    if (duration > 0) {
      setTimeout(() => handleCommand('M5'), duration);
    }
  };

  const handleFrame = async () => {
    if (gcode.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    gcode.forEach(line => {
      const matchX = /X([\d.-]+)/.exec(line);
      const matchY = /Y([\d.-]+)/.exec(line);
      if (matchX) {
        const v = parseFloat(matchX[1]);
        if (v < minX) minX = v;
        if (v > maxX) maxX = v;
      }
      if (matchY) {
        const v = parseFloat(matchY[1]);
        if (v < minY) minY = v;
        if (v > maxY) maxY = v;
      }
    });

    if (minX === Infinity || minY === Infinity) {
      alert("Could not determine bounds from G-code");
      return;
    }

    const cmds = [
      'M3 S10',
      `G0 X${minX} Y${minY}`,
      `G0 X${minX} Y${maxY}`,
      `G0 X${maxX} Y${maxY}`,
      `G0 X${maxX} Y${minY}`,
      `G0 X${minX} Y${minY}`,
      'M5'
    ];

    for (const cmd of cmds) {
      await handleCommand(cmd);
    }
  };

  const [activeTab, setActiveTab] = useState<string | null>('connection');
  const [laserBeamEnabled, setLaserBeamEnabled] = useState(true);

  // State for CAM Objects (Lifted)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [objects, setObjects] = useState<any[]>([]);

  // Milling path analysis state
  const [detectedPaths, setDetectedPaths] = useState<DetectedPath[]>([]);
  const [selectedPathIds, setSelectedPathIds] = useState<string[]>([]);
  /** Position offsets applied by the user dragging paths in the visualizer */
  const [pathOffsets, setPathOffsets] = useState<Record<string, [number, number, number]>>({});

  const handlePathSelect = (id: string, multi: boolean) => {
    setSelectedPathIds(prev =>
      multi
        ? prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        : prev.length === 1 && prev[0] === id ? [] : [id]
    );
  };

  const handlePathMove = (id: string, position: [number, number, number]) => {
    setPathOffsets(prev => ({ ...prev, [id]: position }));
  };

  // Milling operations queue + toolpath preview
  const [millingOperations, setMillingOperations] = useState<MillingOperation[]>([]);
  const [toolpathPolygons, setToolpathPolygons] = useState<ToolpathPolygon[]>([]);
  const [millingLoading, setMillingLoading] = useState(false);
  const [stockSurface, setStockSurface] = useState(0);
  const [millingJobStats, setMillingJobStats] = useState<{ lines: number; estimatedTime: string } | null>(null);

  const handleAddOperation = (op: MillingOperation) => {
    setMillingOperations(prev => [...prev, op]);
    setSelectedPathIds([]);           // clear selection so user can pick next group
    setToolpathPolygons([]);          // invalidate previous preview
    setMillingJobStats(null);
  };

  const handleDeleteOperation = (id: string) => {
    setMillingOperations(prev => prev.filter(o => o.id !== id));
    setToolpathPolygons([]);
    setMillingJobStats(null);
  };

  const handleReorderOperation = (id: string, dir: -1 | 1) => {
    setMillingOperations(prev => {
      const idx = prev.findIndex(o => o.id === id);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
    setMillingJobStats(null);
  };

  const handleClearAllOperations = () => {
    setMillingOperations([]);
    setToolpathPolygons([]);
    setMillingJobStats(null);
  };

  const handleGenerateMilling = async () => {
    if (millingOperations.length === 0 || detectedPaths.length === 0) return;
    setMillingLoading(true);
    setMillingJobStats(null);
    try {
      const res = await fetch(`${API_URL}/cam/generate-milling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paths: detectedPaths,
          pathOffsets,
          operations: millingOperations,
          stockSurface,
        }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        handleGcodeGenerated(data.gcode);
        setToolpathPolygons(data.toolpathPolygons || []);
        setMillingJobStats(data.stats || null);
      } else {
        alert(`[ERROR] ${data.error}`);
      }
    } catch (e: any) {
      alert(`[ERROR] ${e.message}`);
    } finally {
      setMillingLoading(false);
    }
  };

  // Dynamic Sidebar Width (Controlled by children like CamPanel)
  const [sidebarWidth, setSidebarWidth] = useState(400);

  // Reset width when tab changes
  useEffect(() => {
    setSidebarWidth(400);
  }, [activeTab]);

  // Refactor: Mapping activeTab to SidePane Content
  const renderSidePane = () => {
    switch (activeTab) {
      case 'connection':
        return <ConnectionPanel status={status} onConnect={handleConnect} onDisconnect={handleDisconnect} />;
      case 'jog':
        return (
          <div className="space-y-6">
            <ControlPanel status={status} onJog={handleJog} onHome={() => handleCommand('$H')} />
            <MacroPanel
              status={status}
              hasGcode={gcode.length > 0}
              onCommand={handleCommand}
              onProbe={handleProbe}
              onLaserTest={handleLaserTest}
              onFrame={handleFrame}
            />
          </div>
        );
      case 'cam':
        return <CamPanel
          onGenerate={handleGcodeGenerated}
          objects={objects}
          setObjects={setObjects}
          setSidebarWidth={setSidebarWidth}
          machineSettings={draftSettings || status.machineSettings}
          setDetectedPaths={setDetectedPaths}
          detectedPaths={detectedPaths}
          selectedPathIds={selectedPathIds}
          onSelectionChange={setSelectedPathIds}
          millingOperations={millingOperations}
          onAddOperation={handleAddOperation}
          onDeleteOperation={handleDeleteOperation}
          onReorderOperation={handleReorderOperation}
          onClearAllOperations={handleClearAllOperations}
          onGenerateMilling={handleGenerateMilling}
          millingLoading={millingLoading}
          stockSurface={stockSurface}
          onStockSurfaceChange={setStockSurface}
          millingJobStats={millingJobStats}
        />;
      case 'gcode':
        return (
          <div className="h-full flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">G-Code Job ({gcode.length} lines)</h2>
              <div className="flex gap-2">
                <button 
                  onClick={() => handleCommand('G92.1')}
                  className="bg-gray-700 hover:bg-gray-600 text-xs px-3 py-1.5 rounded border border-gray-600 font-bold transition-colors"
                  title="Reset Workspace Offsets (G92.1)"
                >
                  Reset Workspace
                </button>
                {gcode.length > 0 && (
                  <button 
                    onClick={() => setWizardOpen(true)}
                    className="bg-green-600 hover:bg-green-500 text-white text-xs px-4 py-1.5 rounded font-bold shadow-[0_0_10px_rgba(34,197,94,0.4)] transition-all flex items-center gap-2"
                  >
                    Run Job Wizard
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <Terminal logs={status.logs || []} onCommand={handleCommand} />
            </div>
          </div>
        );
      case 'settings':
        return <MachineSettingsPanel
          status={status}
          laserBeamEnabled={laserBeamEnabled}
          setLaserBeamEnabled={setLaserBeamEnabled}
          onSettingsChange={setDraftSettings}
        />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen bg-[#0f172a] text-gray-200 overflow-hidden relative">
      <BackgroundFX />

      {/* LzrCnc Logo Overlay - Top Center (Shifted Right) */}
      <div className="absolute top-0 left-[60%] transform -translate-x-1/2 z-[60] pointer-events-none mt-4">
        <img
          src="/logo.png"
          alt="LzrCnc Logo"
          className="h-20 object-contain"
          style={{
            maskImage: 'radial-gradient(ellipse at center, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 80%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 80%)'
          }}
        />
      </div>

      {/* 1. Left Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        connectionState={status.state}
      />


      {/* 2. Side Pane (Expandable) */}
      {activeTab && (
        <div
          className="border-r border-white/10 bg-[#1e293b]/50 backdrop-blur-md flex flex-col transition-all duration-300 z-40 shadow-2xl"
          style={{ width: sidebarWidth }}
        >
          <div className="p-4 border-b border-white/5 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white capitalize">{activeTab}</h2>
            <button onClick={() => setActiveTab(null)} className="text-gray-500 hover:text-white">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {renderSidePane()}
          </div>
        </div>
      )}

      {/* 3. Main Content (Visualizer) */}
      <div className="flex-1 relative bg-black/40 flex flex-col">
        {!status.machineSettings ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4">
            {connectionError ? (
              <div className="bg-red-900/50 p-6 rounded-lg border border-red-500/30 max-w-md text-center">
                <div className="text-red-400 font-bold mb-2">Connection Error</div>
                <div className="font-mono text-sm text-gray-300 mb-4">{connectionError}</div>
                <div className="text-xs text-gray-600">Checking: {API_URL || 'Current Host'}/status</div>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-4 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded text-sm font-bold"
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
                <div className="animate-spin w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full" />
                <span className="animate-pulse">Loading configurations...</span>
                <span className="text-xs text-gray-600">Waiting for server...</span>
              </>
            )}
          </div>
        ) : (
          <VisualizerScene
            machinePos={status.pos}
            limits={status.limits}
            gcode={gcode}
            laserBeamEnabled={laserBeamEnabled}
            machineSettings={draftSettings || status.machineSettings}
            objects={objects}
            onSelectObject={(id) => {
              setObjects(prev => prev.map(o => ({ ...o, selected: o.id === id })));
            }}
            onObjectUpdate={(id: string, updates: any) => {
              setObjects(objs => objs.map(o => o.id === id ? { ...o, ...updates } : o));
            }}
            detectedPaths={detectedPaths}
            selectedPathIds={selectedPathIds}
            onPathSelect={handlePathSelect}
            onPathMove={handlePathMove}
            toolpathPolygons={toolpathPolygons}
          />
        )}

        {/* Overlay Status Bar */}
        <div className="absolute top-4 right-[50px] flex gap-4 pointer-events-none">
          <div className="glass-panel px-4 py-2 flex items-center gap-2 pointer-events-auto">
            <Activity size={16} className={status.state !== 'Disconnected' ? "text-green-400" : "text-gray-500"} />
            <span className="font-mono font-bold mr-2 whitespace-nowrap">{status.state}</span>
            <span className="text-sm text-gray-400 whitespace-nowrap">
              X:{status.pos.x.toFixed(1)} Y:{status.pos.y.toFixed(1)} Z:{status.pos.z.toFixed(1)}
            </span>
          </div>
        </div>
      </div>

      <JobWizardModal 
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onExecute={executeJob}
        status={status}
        gcodeData={gcode}
        machineSettings={draftSettings || status.machineSettings}
        onCommand={handleCommand}
      />
    </div>
  );
}

export default App;
