import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ConnectionPanel } from './components/ConnectionPanel';
import { ControlPanel } from './components/ControlPanel';
import CamPanel from './components/CamPanel';
import Terminal from './components/Terminal';
import MacroPanel from './components/MacroPanel';
import UserMacrosPanel from './components/UserMacrosPanel';
import VisualizerScene from './components/Visualizer/VisualizerScene';
import type { MachineStatus, SceneObject, MachineSettings } from './types';
import { Activity, Pause, Play, Square, Download } from 'lucide-react';
import type { CamTab } from './components/CamPanel';
import type { MillController } from './components/cam/MillPanel';
import {
  DEFAULT_STOCK, buildMillRequest, carve, createHeightfield, isMillGcode, millContours, millCutArea, millTopZ, simMoves,
  type Heightfield, type MillOp, type MillResult, type MillStock,
} from './utils/millJob';

import { Sidebar } from './components/Sidebar';
import { BrandLogo, LogoMark } from './components/Logo';
import MachineSettingsPanel from './components/MachineSettingsPanel';
import { JobWizardModal } from './components/cnc/JobWizardModal';
import { apiGet, apiPost, API_URL } from './api';
import { parseGcode, stripComment, formatDuration } from './utils/gcodeParser';
import { usePersistentState } from './utils/usePersistentState';

const STATUS_POLL_MS = 250;

const STATE_STYLE: Record<string, string> = {
  Idle: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  Run: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  Jog: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  Home: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  Hold: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  Door: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  Alarm: 'text-red-400 bg-red-500/15 border-red-500/40',
  Disconnected: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
};

function App() {
  const [status, setStatus] = useState<MachineStatus>({
    state: 'Disconnected',
    pos: { x: 0, y: 0, z: 0 },
    feedrate: 0,
    spindle: 0,
    logs: []
  });

  const [gcode, setGcode] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>('connection');
  const [laserBeamEnabled, setLaserBeamEnabled] = usePersistentState('lzrcnc.fx', false);

  const handleGcodeGenerated = (generated: string) => {
    setGcode(generated.split(/\r?\n/));
    setActiveTab('gcode');
  };

  // Live preview of settings being edited (overrides server settings while editing)
  const [draftSettings, setDraftSettings] = useState<MachineSettings | null>(null);
  // Unsaved edits are previewed only while the settings panel is open
  const shownSettings = (activeTab === 'settings' && draftSettings) || status.machineSettings;
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiGet<Partial<MachineStatus>>('/status');
      setStatus(prev => ({
        ...prev,
        ...data,
        pos: data.pos || prev.pos || { x: 0, y: 0, z: 0 }
      }));
      setConnectionError(null);
    } catch (e: unknown) {
      setConnectionError((e as Error).message || 'Connection Failed');
    }
  }, []);

  // Chained timeout (not setInterval) so slow responses never pile up.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await fetchStatus();
      if (alive) timer = setTimeout(loop, STATUS_POLL_MS);
    };
    loop();
    return () => { alive = false; clearTimeout(timer); };
  }, [fetchStatus]);

  const report = (e: unknown) => alert(`[ERROR] ${(e as Error).message}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleConnect = async (type: 'grbl' | 'klipper' | 'mock', config: any) => {
    try {
      await apiPost('/connect', { type, ...config });
      fetchStatus();
    } catch (e) { report(e); }
  };

  const handleDisconnect = async () => {
    try {
      await apiPost('/disconnect');
      fetchStatus();
    } catch (e) { report(e); }
  };

  const handleJog = async (axis: 'x' | 'y' | 'z', dist: number, feedrate: number) => {
    try {
      await apiPost('/jog', { axis, dist, feedrate });
    } catch (e) { console.error(e); }
  };

  const handleCommand = useCallback(async (cmd: string) => {
    try {
      await apiPost('/command', { gcode: cmd });
    } catch (e) { report(e); }
  }, []);

  // Job progress → raw G-code line, used to draw executed cuts in the viewer
  const jobSetupCount = useRef(0);
  const execLineIndex = useMemo(() => {
    const idx: number[] = [];
    gcode.forEach((l, i) => { if (stripComment(l)) idx.push(i); });
    return idx;
  }, [gcode]);

  const executeJob = async (setupCmds: string[]) => {
    try {
      jobSetupCount.current = setupCmds.length;
      await apiPost('/cam/stream-job', { setupCommands: setupCmds, gcode });
      fetchStatus();
    } catch (e) { report(e); }
  };

  const jobAction = async (action: 'pause' | 'resume' | 'stop') => {
    try {
      await apiPost(`/job/${action}`);
      fetchStatus();
    } catch (e) { report(e); }
  };

  const handleProbe = async (options: unknown) => {
    try {
      await apiPost('/probe', options);
    } catch (e) { report(e); }
  };

  const maxS = status.grblSettings?.[30] || status.machineSettings?.spindleMax || 1000;

  const handleLaserTest = async (powerPct: number, duration: number) => {
    const sVal = Math.floor((powerPct / 100) * maxS);
    await handleCommand(sVal > 0 ? `M3 S${sVal}` : 'M5');
    if (duration > 0) setTimeout(() => handleCommand('M5'), duration);
  };

  const parsedJob = useMemo(() => parseGcode(gcode), [gcode]);
  const gcodeIsMill = useMemo(() => isMillGcode(gcode), [gcode]);
  // G-code Z of the stock top (0 for Z0-on-top programs, the thickness for Z0-on-bottom programs)
  const gcodeTopZ = useMemo(() => gcodeIsMill ? millTopZ(gcode) : 0, [gcode, gcodeIsMill]);

  /**
   * Traces the job's bounding box with the laser/spindle off. Mill jobs first lift to safe Z above the
   * stock top and trace the area swept by the tool (tool-centre bounds grown by the largest tool radius).
   */
  const handleFrame = async () => {
    if (gcode.length === 0) return;
    const b = parsedJob.segments.some(s => s.kind === 'cut') ? parsedJob.cutBounds : parsedJob.bounds;
    if (b.min.x === b.max.x && b.min.y === b.max.y) {
      alert('Could not determine bounds from G-code');
      return;
    }
    const r = gcodeIsMill ? Math.max(0, ...gcode.map(l => parseFloat(l.match(/TOOL D=([\d.]+)/)?.[1] ?? '0') / 2)) : 0;
    const f = (n: number) => n.toFixed(3);
    const cmds = [
      'M5', 'G90',
      ...(gcodeIsMill ? [`G0 Z${f(gcodeTopZ + Math.max(1, millStock.safeZ))}`] : []),
      `G0 X${f(b.min.x - r)} Y${f(b.min.y - r)}`,
      `G0 X${f(b.min.x - r)} Y${f(b.max.y + r)}`,
      `G0 X${f(b.max.x + r)} Y${f(b.max.y + r)}`,
      `G0 X${f(b.max.x + r)} Y${f(b.min.y - r)}`,
      `G0 X${f(b.min.x - r)} Y${f(b.min.y - r)}`,
    ];
    for (const cmd of cmds) await handleCommand(cmd);
  };

  const downloadGcode = () => {
    const blob = new Blob([gcode.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lzrcnc-job.gcode';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const [objects, setObjects] = useState<SceneObject[]>([]);

  // ── Milling (2.5D router) workspace ──────────────────────────────────────
  const [camTab, setCamTab] = useState<CamTab>('laser');
  const [millStock, setMillStock] = usePersistentState<MillStock>('lzrcnc.mill.stock', DEFAULT_STOCK);
  const [millOps, setMillOps] = usePersistentState<MillOp[]>('lzrcnc.mill.ops', []);
  const [selectedContourIds, setSelectedContourIds] = useState<string[]>([]);
  const [millResult, setMillResult] = useState<MillResult | null>(null);
  const [millLoading, setMillLoading] = useState(false);
  const [simEnabled, setSimEnabled] = useState(false);
  const [simProgress, setSimProgress] = useState(1);
  const [sim, setSim] = useState<{ hf: Heightfield; version: number } | null>(null);
  const [simBusy, setSimBusy] = useState(false);

  // Contours only depend on geometry, not on which object is selected in the list.
  const geometryKey = objects.map(o => [o.id, o.type, o.content.length, o.position, o.rotation, o.scale, o.size, o.svgUnitsMm, JSON.stringify(o.parametric ?? null)].join('|')).join(';');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const contours = useMemo(() => millContours(objects), [geometryKey]);
  const contourKey = contours.map(c => c.id).join(',');

  useEffect(() => {
    setSelectedContourIds(ids => ids.filter(id => contours.some(c => c.id === id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contourKey]);

  // Any change to the setup makes the computed toolpaths stale.
  useEffect(() => { setMillResult(null); setSim(null); }, [millStock, millOps, geometryKey]);

  const handleContourSelect = useCallback((id: string, multi: boolean) => {
    setSelectedContourIds(prev => multi
      ? prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      : prev.length === 1 && prev[0] === id ? [] : [id]);
  }, []);

  const generateMill = async () => {
    setMillLoading(true);
    try {
      const data = await apiPost<MillResult & { status: string }>('/cam/generate-milling', buildMillRequest(millStock, millOps, contours));
      setMillResult(data);
      setSimProgress(1);
      // Show the program in the 3D view (inside the stock) without leaving the Mill tab.
      if (data.gcode) setGcode(data.gcode.split(/\r?\n/));
    } catch (e) {
      report(e);
    } finally {
      setMillLoading(false);
    }
  };

  // Material removal simulation, carved incrementally while the slider moves forward.
  const millCutAreaBox = useMemo(() => millResult ? millCutArea(millResult, millOps) : null, [millResult, millOps]);

  const millMoves = useMemo(() => {
    if (!millResult) return [];
    const lines = millResult.gcode.split(/\r?\n/);
    return simMoves(lines, millTopZ(lines));
  }, [millResult]);
  const simState = useRef<{ hf: Heightfield; done: number; moves: unknown; stockKey: string } | null>(null);
  useEffect(() => {
    if (!simEnabled || !millResult) { setSim(null); simState.current = null; return; }
    setSimBusy(true);
    const timer = setTimeout(() => {
      const target = Math.round(millMoves.length * simProgress);
      const stockKey = `${millStock.width}|${millStock.height}|${millStock.thickness}|${millStock.x}|${millStock.y}`;
      let st = simState.current;
      if (!st || st.moves !== millMoves || st.stockKey !== stockKey) {
        st = { hf: createHeightfield(millStock), done: 0, moves: millMoves, stockKey };
      } else if (target < st.done) {
        st.hf.h.fill(st.hf.thickness);
        st.done = 0;
      }
      carve(st.hf, millMoves, target, st.done);
      st.done = target;
      simState.current = st;
      setSim(s => ({ hf: st!.hf, version: (s?.version ?? 0) + 1 }));
      setSimBusy(false);
    }, 16);
    return () => clearTimeout(timer);
  }, [simEnabled, simProgress, millMoves, millResult, millStock]);

  const millController: MillController = {
    stock: millStock,
    setStock: setMillStock,
    ops: millOps,
    setOps: setMillOps,
    contours,
    selectedContourIds,
    setSelectedContourIds,
    result: millResult,
    loading: millLoading,
    generate: generateMill,
    sendToJob: () => { if (millResult?.gcode) handleGcodeGenerated(millResult.gcode); },
    simEnabled,
    setSimEnabled,
    simProgress,
    setSimProgress,
    simBusy,
    cutArea: millCutAreaBox,
    machineReady: status.state === 'Idle' && status.job?.state !== 'running' && status.job?.state !== 'paused',
    machineState: status.state,
    sendCommands: async (cmds: string[]) => { for (const c of cmds) await handleCommand(c); },
    runJob: () => { if (millResult?.gcode) { setGcode(millResult.gcode.split(/\r?\n/)); setWizardOpen(true); } },
  };
  // Dynamic Sidebar Width (Controlled by children like CamPanel)
  const [sidebarWidth, setSidebarWidth] = useState(400);
  useEffect(() => { setSidebarWidth(400); }, [activeTab]);

  const job = status.job;
  const jobActive = job?.state === 'running' || job?.state === 'paused';
  const progressLine = useMemo(() => {
    if (!job || job.state === 'idle') return -1;
    const k = job.acked - jobSetupCount.current - 1;
    if (k < 0) return -1;
    return execLineIndex[Math.min(k, execLineIndex.length - 1)] ?? -1;
  }, [job, execLineIndex]);

  const renderSidePane = () => {
    switch (activeTab) {
      case 'connection':
        return <ConnectionPanel status={status} onConnect={handleConnect} onDisconnect={handleDisconnect} onMachineChanged={fetchStatus} />;
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
          machineSettings={shownSettings}
          maxS={maxS}
          mill={millController}
          activeTab={camTab}
          onTabChange={setCamTab}
        />;
      case 'gcode': {
        const b = parsedJob.cutBounds;
        const connected = status.state !== 'Disconnected';
        return (
          <div className="h-full flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Stat label="Lines" value={gcode.filter(l => l.trim()).length.toLocaleString()} />
              <Stat label="Est. time" value={formatDuration(parsedJob.estimatedTime)} />
              <Stat label="Size X × Y" value={gcode.length ? `${(b.max.x - b.min.x).toFixed(1)} × ${(b.max.y - b.min.y).toFixed(1)} mm` : '—'} />
              <Stat label="Origin" value={gcode.length ? `X${b.min.x.toFixed(1)} Y${b.min.y.toFixed(1)}` : '—'} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setWizardOpen(true)}
                disabled={!connected || gcode.length === 0 || jobActive}
                className="btn-primary flex items-center gap-2 text-sm"
                title={connected ? 'Home, zero, frame and run' : 'Connect a machine (or the simulator) first'}
              >
                <Play size={14} /> Run job…
              </button>
              <button onClick={handleFrame} disabled={!connected || gcode.length === 0 || jobActive} className="btn-secondary text-sm">Frame</button>
              <button onClick={downloadGcode} disabled={gcode.length === 0} className="btn-secondary text-sm flex items-center gap-1"><Download size={14} /> Save</button>
              <button onClick={() => setGcode([])} disabled={gcode.length === 0 || jobActive} className="btn-secondary text-sm">Clear</button>
            </div>
            <div className="flex-1 min-h-[240px] overflow-hidden">
              <Terminal logs={status.logs || []} onCommand={handleCommand} />
            </div>
          </div>
        );
      }
      case 'macros':
        return <UserMacrosPanel status={status} onCommand={handleCommand} />;
      case 'settings':
        return <MachineSettingsPanel
          status={status}
          laserBeamEnabled={laserBeamEnabled}
          setLaserBeamEnabled={setLaserBeamEnabled}
          onSettingsChange={setDraftSettings}
          onMachinesChanged={fetchStatus}
        />;
      default:
        return null;
    }
  };

  const pct = job && job.total > 0 ? Math.min(100, (job.acked / job.total) * 100) : 0;
  const elapsed = job?.startedAt ? ((job.finishedAt ?? Date.now()) - job.startedAt) / 1000 : 0;
  const eta = pct > 1 && job?.state === 'running' ? elapsed * (100 - pct) / pct : 0;

  return (
    <div className="flex h-screen bg-[#0f172a] text-gray-200 overflow-hidden relative">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        connectionState={status.state}
      />

      {activeTab && (
        <div
          className="border-r border-white/10 bg-[#1e293b]/70 backdrop-blur-md flex flex-col transition-all duration-300 z-40 shadow-2xl"
          style={{ width: sidebarWidth }}
        >
          <div className="px-4 py-3 border-b border-white/5 flex justify-between items-center">
            <h2 className="text-base font-semibold text-white capitalize tracking-wide">{activeTab === 'jog' ? 'Control' : activeTab === 'gcode' ? 'G-Code job' : activeTab}</h2>
            <button onClick={() => setActiveTab(null)} className="text-gray-500 hover:text-white" title="Close panel">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {renderSidePane()}
          </div>
        </div>
      )}

      <div className="flex-1 relative bg-black/40 flex flex-col min-w-0">
        {!status.machineSettings ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4">
            {connectionError ? (
              <div className="bg-red-900/50 p-6 rounded-lg border border-red-500/30 max-w-md text-center">
                <div className="text-red-400 font-bold mb-2">Server unreachable</div>
                <div className="font-mono text-sm text-gray-300 mb-4">{connectionError}</div>
                <div className="text-xs text-gray-500">Checking: {API_URL || window.location.origin}/status</div>
                <button onClick={() => window.location.reload()} className="mt-4 btn-danger text-sm">Retry</button>
              </div>
            ) : (
              <>
                <div className="animate-spin w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full" />
                <span className="animate-pulse">Loading configuration…</span>
              </>
            )}
          </div>
        ) : (
          <VisualizerScene
            machinePos={status.pos}
            limits={status.limits}
            gcode={gcode}
            progressLine={progressLine}
            spindle={status.spindle}
            laserBeamEnabled={laserBeamEnabled}
            machineSettings={shownSettings}
            objects={objects}
            onSelectObject={(id) => setObjects(prev => prev.map(o => ({ ...o, selected: o.id === id })))}
            onObjectUpdate={(id, updates) => setObjects(objs => objs.map(o => o.id === id ? { ...o, ...updates } : o))}
            gcodeIsMill={gcodeIsMill}
            gcodeTopZ={gcodeTopZ}
            mill={{
              active: activeTab === 'cam' && camTab === 'mill',
              stock: millStock,
              contours,
              selectedContourIds,
              onContourSelect: handleContourSelect,
              result: millResult,
              showToolpaths: !gcodeIsMill,
              sim: simEnabled ? sim : null,
              cutArea: millCutAreaBox,
            }}
          />
        )}

        {/* Brand logo (top centre, clear of the view buttons and status pill) */}
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 pointer-events-none hidden lg:block z-10">
          <BrandLogo />
        </div>

        {/* Top status bar */}
        <div className="absolute top-3 right-3 flex items-center gap-2 pointer-events-none">
          <div className="glass-panel px-3 py-1.5 flex items-center gap-3 pointer-events-auto">
            <LogoMark size={18} glow={false} className="lg:hidden" />
            {status.activeMachine && (
              <span className="text-xs text-slate-300 max-w-[14rem] truncate" title="Active machine profile (Settings › Machines)">
                {status.activeMachine.name}
              </span>
            )}
            {status.connectionType === 'mock' && status.state !== 'Disconnected' && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border text-violet-300 bg-violet-500/10 border-violet-500/30" title="Simulated machine, no hardware">SIM</span>
            )}
            <span className={`flex items-center gap-1.5 text-xs font-mono font-bold px-2 py-0.5 rounded border ${STATE_STYLE[status.state] ?? STATE_STYLE.Idle}`}>
              <Activity size={12} /> {status.state}
            </span>
            {status.state !== 'Disconnected' && (
              <span className="text-xs text-slate-400 font-mono whitespace-nowrap">
                F{Math.round(status.feedrate || 0)} S{Math.round(status.spindle || 0)}
              </span>
            )}
          </div>
        </div>

        {/* Job progress bar */}
        {job && job.state !== 'idle' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 glass-panel px-4 py-3 w-[min(560px,90%)] pointer-events-auto z-30">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-semibold uppercase tracking-wider">
                {job.state === 'running' ? 'Running' : job.state === 'paused' ? 'Paused' : job.state === 'done' ? 'Job complete' : job.state === 'stopped' ? 'Stopped' : 'Error'}
              </span>
              <span className="font-mono text-slate-400">
                {job.acked.toLocaleString()} / {job.total.toLocaleString()} · {formatDuration(elapsed)}{eta > 0 ? ` · ~${formatDuration(eta)} left` : ''}
              </span>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${job.state === 'error' ? 'bg-red-500' : job.state === 'paused' ? 'bg-amber-400' : job.state === 'done' ? 'bg-emerald-500' : 'bg-cyan-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {job.error && <div className="text-xs text-red-400 mt-2 font-mono">{job.error}</div>}
            {jobActive && (
              <div className="flex gap-2 mt-3 justify-end">
                {job.state === 'running'
                  ? <button onClick={() => jobAction('pause')} className="btn-secondary text-xs flex items-center gap-1"><Pause size={12} /> Pause</button>
                  : <button onClick={() => jobAction('resume')} className="btn-primary text-xs flex items-center gap-1"><Play size={12} /> Resume</button>}
                <button onClick={() => jobAction('stop')} className="btn-danger text-xs flex items-center gap-1"><Square size={12} /> Stop</button>
              </div>
            )}
          </div>
        )}
      </div>

      <JobWizardModal
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onExecute={executeJob}
        status={status}
        gcodeData={gcode}
        machineSettings={shownSettings}
        onCommand={handleCommand}
        onFrame={handleFrame}
        mill={gcodeIsMill ? { stock: millStock, zZero: gcodeTopZ > 0 ? 'bottom' : 'top' } : null}
      />
    </div>
  );
}

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-slate-900/60 border border-white/5 rounded-lg px-3 py-2">
    <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className="font-mono text-slate-100 mt-0.5">{value}</div>
  </div>
);

export default App;
