import React, { useState } from 'react';
import { HelpIcon } from '../ui/Tooltip';
import { AlertTriangle, ChevronRight } from 'lucide-react';

interface MillMachineSetupProps {
    /** Sends raw G-code / GRBL commands in order. Undefined or `ready=false` disables the buttons. */
    send?: (cmds: string[]) => Promise<void>;
    ready: boolean;
    /** Where the program's Z0 is (from the stock setup). */
    zZero: 'top' | 'bottom';
}

const Section: React.FC<{ title: string; help?: string; children: React.ReactNode }> = ({ title, help, children }) => (
    <details className="group bg-black/30 rounded-lg border border-white/5">
        <summary className="flex items-center gap-1.5 px-3 py-2 cursor-pointer select-none text-[10px] uppercase font-bold text-gray-400 hover:text-white list-none">
            <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
            {title}
            {help && <HelpIcon text={help} />}
        </summary>
        <div className="px-3 pb-3 space-y-2">{children}</div>
    </details>
);

/** Router machine setup used by the Mill tab: work Z0 / touch-plate probe, Z direction test and spindle control. */
export const MillMachineSetup: React.FC<MillMachineSetupProps> = ({ send, ready, zZero }) => {
    const [plate, setPlate] = useState(20);
    const [probeFeed, setProbeFeed] = useState(100);
    const [testRpm, setTestRpm] = useState(10000);
    const disabled = !send || !ready;

    const run = async (cmds: string[], confirmText?: string) => {
        if (disabled) return;
        if (confirmText && !confirm(confirmText)) return;
        await send!(cmds);
    };

    const btn = 'py-1.5 rounded text-xs border transition-colors disabled:opacity-40';
    const surface = zZero === 'bottom' ? 'bed / spoilboard (stock bottom)' : 'stock top';

    return (
        <div className="space-y-2 text-white">
            <Section title={`Work Z0 (${surface})`} help={`This program expects Z0 on the ${surface} (step 1). Jog the bit until it just touches it (paper method) and set Z0, or use a touch plate.`}>
                <div className="grid grid-cols-2 gap-2">
                    <button disabled={disabled} onClick={() => run(['G10 L20 P1 Z0'], `Set Z0 at the current tool position (tool tip touching the ${surface})?`)}
                        className={`${btn} bg-emerald-700/40 hover:bg-emerald-600/50 border-emerald-500/30`}>Set Z0 here</button>
                    <button disabled={disabled} onClick={() => run(['G91', 'G0 Z10', 'G90'])}
                        className={`${btn} bg-white/5 hover:bg-white/10 border-white/10`}>Lift Z +10 mm</button>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                    <label className="text-[10px] text-gray-500">Touch plate (mm)
                        <input type="number" step={0.01} value={plate} onChange={e => setPlate(parseFloat(e.target.value) || 0)} className="w-full mt-0.5 bg-black/50 border border-white/10 rounded px-2 py-1 text-xs font-mono text-white" />
                    </label>
                    <label className="text-[10px] text-gray-500">Probe feed (mm/min)
                        <input type="number" step={10} value={probeFeed} onChange={e => setProbeFeed(Math.max(10, parseFloat(e.target.value) || 100))} className="w-full mt-0.5 bg-black/50 border border-white/10 rounded px-2 py-1 text-xs font-mono text-white" />
                    </label>
                </div>
                <button disabled={disabled}
                    onClick={() => run(['G91', `G38.2 Z-30 F${probeFeed}`, 'G90', `G10 L20 P1 Z${plate.toFixed(3)}`, 'G91', 'G0 Z5', 'G90'],
                        `Probe down (max 30 mm) at ${probeFeed} mm/min? The touch plate must be on the ${surface} under the bit and the clip attached.`)}
                    className={`${btn} w-full bg-cyan-700/40 hover:bg-cyan-600/50 border-cyan-500/30`}>Probe Z with touch plate</button>
                <button disabled={disabled} onClick={() => run(['G91', 'G0 Z10', 'G0 Z-10', 'G90'], 'Z direction test: the head should go UP 10 mm, then back down. If it goes DOWN first, your Z axis is inverted ($3 direction mask). Make sure there are 10 mm free below the tool. Continue?')}
                    className="w-full border border-gray-600 text-gray-400 text-[10px] py-1 rounded hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40">
                    Test Z direction (up 10 mm, then back)
                </button>
            </Section>

            <Section title="Spindle (optional)" help="Only for spindles controlled by GRBL (PWM / relay). Skip this if your router is switched on by hand.">
                <div className="flex items-start gap-2 text-[10px] text-amber-200 bg-amber-900/20 border border-amber-600/30 rounded p-2">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>GRBL must be in <b>spindle mode ($32=0)</b> for milling; switch back to <b>$32=1</b> for laser work.</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <button disabled={disabled} onClick={() => run(['$32=0'], 'Switch GRBL to spindle mode ($32=0)?')} className={`${btn} bg-white/5 hover:bg-white/10 border-white/10`}>$32=0 · spindle</button>
                    <button disabled={disabled} onClick={() => run(['$32=1'], 'Switch GRBL to laser mode ($32=1)?')} className={`${btn} bg-white/5 hover:bg-white/10 border-white/10`}>$32=1 · laser</button>
                </div>
                <div className="flex items-center gap-2">
                    <input type="number" step={500} value={testRpm} onChange={e => setTestRpm(Math.max(0, parseFloat(e.target.value) || 0))} className="w-20 bg-black/50 border border-white/10 rounded px-2 py-1 text-xs font-mono text-white" />
                    <span className="text-[10px] text-gray-500">rpm</span>
                    <button disabled={disabled} onClick={() => run([`M3 S${Math.round(testRpm)}`], 'Start the spindle? Keep hands clear.')} className={`${btn} flex-1 bg-orange-700/40 hover:bg-orange-600/50 border-orange-500/30`}>On</button>
                    <button disabled={!send} onClick={() => send?.(['M5'])} className={`${btn} flex-1 bg-red-700/40 hover:bg-red-600/50 border-red-500/30`}>Stop (M5)</button>
                </div>
            </Section>
        </div>
    );
};
