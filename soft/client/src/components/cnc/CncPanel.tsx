import React, { useState } from 'react';
import { ToolManager } from './ToolManager';
import { HelpIcon } from '../ui/Tooltip';
import { AlertTriangle } from 'lucide-react';

interface CncPanelProps {
    onCommand?: (cmd: string) => void | Promise<void>;
}

/** CNC router setup: Z zeroing / probing, spindle checks and the tool library. */
export const CncPanel: React.FC<CncPanelProps> = ({ onCommand }) => {
    const [plate, setPlate] = useState(20);
    const [probeFeed, setProbeFeed] = useState(100);
    const [testRpm, setTestRpm] = useState(10000);

    const send = async (cmds: string[], confirmText?: string) => {
        if (!onCommand) return;
        if (confirmText && !confirm(confirmText)) return;
        for (const c of cmds) await onCommand(c);
    };

    const btn = 'py-2 rounded text-xs border transition-colors disabled:opacity-40';

    return (
        <div className="flex flex-col space-y-4 text-white">
            <div className="glass-panel p-4 rounded-xl border border-white/10 space-y-3">
                <h4 className="font-bold text-orange-400 text-[10px] uppercase tracking-[0.2em]">Work zero (Z0 = stock top)</h4>
                <p className="text-[10px] text-gray-500">Mill programs from the Mill tab expect Z0 on the <b>top of the raw stock</b>. Jog the tool until it just touches the stock (paper method), then set Z0 — or use a touch plate.</p>
                <div className="grid grid-cols-2 gap-2">
                    <button disabled={!onCommand} onClick={() => send(['G10 L20 P1 Z0'], 'Set Z0 at the current tool position (tool tip touching the stock top)?')}
                        className={`${btn} bg-emerald-700/40 hover:bg-emerald-600/50 border-emerald-500/30`}>Set Z0 here</button>
                    <button disabled={!onCommand} onClick={() => send(['G91', 'G0 Z10', 'G90'])}
                        className={`${btn} bg-white/5 hover:bg-white/10 border-white/10`}>Lift Z +10 mm</button>
                </div>

                <div className="bg-black/30 rounded-lg p-3 border border-white/5 space-y-2">
                    <div className="flex items-center gap-1 text-[10px] uppercase font-bold text-gray-400">Touch plate probe <HelpIcon text="Place the plate on the stock, clip the probe wire to the bit. The tool moves down at the probe feed until it touches, then sets Z = plate thickness and lifts 5 mm." /></div>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="text-[10px] text-gray-500">Plate thickness (mm)
                            <input type="number" step={0.01} value={plate} onChange={e => setPlate(parseFloat(e.target.value) || 0)} className="w-full mt-0.5 bg-black/50 border border-white/10 rounded px-2 py-1 text-xs font-mono text-white" />
                        </label>
                        <label className="text-[10px] text-gray-500">Probe feed (mm/min)
                            <input type="number" step={10} value={probeFeed} onChange={e => setProbeFeed(Math.max(10, parseFloat(e.target.value) || 100))} className="w-full mt-0.5 bg-black/50 border border-white/10 rounded px-2 py-1 text-xs font-mono text-white" />
                        </label>
                    </div>
                    <button disabled={!onCommand}
                        onClick={() => send(['G91', `G38.2 Z-30 F${probeFeed}`, 'G90', `G10 L20 P1 Z${plate.toFixed(3)}`, 'G91', 'G0 Z5', 'G90'],
                            `Probe down (max 30 mm) at ${probeFeed} mm/min? The touch plate must be under the bit and the clip attached.`)}
                        className={`${btn} w-full bg-cyan-700/40 hover:bg-cyan-600/50 border-cyan-500/30`}>Probe Z with touch plate</button>
                </div>

                <button disabled={!onCommand} onClick={() => send(['G91', 'G0 Z10', 'G0 Z-10', 'G90'], 'Z direction test: the head should go UP 10 mm, then back down. If it goes DOWN first, your Z axis is inverted ($3 direction mask). Make sure there are 10 mm free below the tool. Continue?')}
                    className="w-full border border-gray-600 text-gray-400 text-[10px] py-1 rounded hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40">
                    Test Z direction (up 10 mm, then back)
                </button>
            </div>

            <div className="glass-panel p-4 rounded-xl border border-white/10 space-y-3">
                <h4 className="font-bold text-orange-400 text-[10px] uppercase tracking-[0.2em]">Spindle</h4>
                <div className="flex items-start gap-2 text-[10px] text-amber-200 bg-amber-900/20 border border-amber-600/30 rounded p-2">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>GRBL must be in <b>spindle mode ($32=0)</b> for milling. In laser mode ($32=1) GRBL does not wait for the spindle and moves on G0 with the spindle off. Switch back to $32=1 for laser work.</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <button disabled={!onCommand} onClick={() => send(['$32=0'], 'Switch GRBL to spindle mode ($32=0)?')} className={`${btn} bg-white/5 hover:bg-white/10 border-white/10`}>$32=0 · spindle mode</button>
                    <button disabled={!onCommand} onClick={() => send(['$32=1'], 'Switch GRBL to laser mode ($32=1)?')} className={`${btn} bg-white/5 hover:bg-white/10 border-white/10`}>$32=1 · laser mode</button>
                </div>
                <div className="flex items-center gap-2">
                    <input type="number" step={500} value={testRpm} onChange={e => setTestRpm(Math.max(0, parseFloat(e.target.value) || 0))} className="w-24 bg-black/50 border border-white/10 rounded px-2 py-1 text-xs font-mono text-white" />
                    <span className="text-[10px] text-gray-500">rpm</span>
                    <button disabled={!onCommand} onClick={() => send([`M3 S${Math.round(testRpm)}`], 'Start the spindle? Keep hands clear.')} className={`${btn} flex-1 bg-orange-700/40 hover:bg-orange-600/50 border-orange-500/30`}>Spindle on</button>
                    <button disabled={!onCommand} onClick={() => send(['M5'])} className={`${btn} flex-1 bg-red-700/40 hover:bg-red-600/50 border-red-500/30`}>Stop (M5)</button>
                </div>
            </div>

            <ToolManager />
        </div>
    );
};
