import React, { useRef, useEffect, useState } from 'react';

interface TerminalProps {
    logs: string[];
    onCommand: (cmd: string) => void;
}

const Terminal: React.FC<TerminalProps> = ({ logs, onCommand }) => {
    const [input, setInput] = useState('');
    const endRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim()) {
            onCommand(input.trim());
            setInput('');
        }
    };

    return (
        <div className="glass-panel flex flex-col h-full font-mono text-xs">
            <div className="flex-1 overflow-y-auto p-4 space-y-1 text-gray-400 bg-black/40 rounded-t-lg">
                <div className="text-gray-600 border-b border-gray-700 pb-1 mb-2">System Console</div>
                {logs && logs.map((log, i) => (
                    <div key={i} className="break-all hover:bg-white/5 px-1 rounded">
                        {log}
                    </div>
                ))}
                <div ref={endRef} />
            </div>
            <form onSubmit={handleSend} className="p-2 bg-black/60 rounded-b-lg border-t border-white/5 flex gap-2">
                <span className="text-[var(--accent-color)] pt-1">&gt;</span>
                <input
                    className="bg-transparent flex-1 outline-none text-white placeholder-gray-600"
                    placeholder="Send G-code..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                />
            </form>
        </div>
    );
};

export default Terminal;
