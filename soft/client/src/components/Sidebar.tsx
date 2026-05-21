import { Zap, Grid, Terminal, Settings, FolderOpen, Move } from 'lucide-react';

interface SidebarProps {
    activeTab: string | null;
    onTabChange: (tab: string | null) => void;
    connectionState: string;
}

export function Sidebar({ activeTab, onTabChange, connectionState }: SidebarProps) {
    const isConnected = connectionState !== 'Disconnected';

    const navItems = [
        { id: 'connection', icon: Zap, label: 'Connection' },
        { id: 'jog', icon: Move, label: 'Control', disabled: !isConnected },
        { id: 'cam', icon: Grid, label: 'CAM' },
        { id: 'gcode', icon: Terminal, label: 'G-Code', disabled: !isConnected },
        { id: 'macros', icon: FolderOpen, label: 'Macros', disabled: !isConnected },
        { id: 'settings', icon: Settings, label: 'Settings' },
    ];

    return (
        <div className="w-[var(--sidebar-width)] bg-[var(--bg-color)] border-r border-[var(--panel-border)] flex flex-col items-center py-4 z-50">
            {/* Logo Area */}
            <div className="mb-8 p-2 bg-[var(--accent-color)] rounded-lg shadow-lg shadow-[rgba(6,182,212,0.4)]">
                <Zap className="text-white" size={20} fill="currentColor" />
            </div>

            {/* Nav Items */}
            <div className="flex flex-col gap-4 w-full">
                {navItems.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => onTabChange(activeTab === item.id ? null : item.id)}
                        disabled={item.disabled}
                        className={`
              w-full h-[50px] flex items-center justify-center relative transition-all duration-200 group
              ${activeTab === item.id ? 'text-[var(--accent-color)] bg-white/5' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'}
              ${item.disabled ? 'opacity-30 cursor-not-allowed' : ''}
            `}
                        title={item.label}
                    >
                        <item.icon size={24} className={`transition-transform duration-300 ${activeTab === item.id ? 'scale-110 drop-shadow-[0_0_8px_var(--accent-color)]' : 'group-hover:scale-110'}`} />
                        {activeTab === item.id && (
                            <div className="absolute inset-y-0 right-0 w-[2px] bg-[var(--accent-color)] shadow-[0_0_10px_var(--accent-color)]" />
                        )}
                    </button>
                ))}
            </div>

            {/* Connection Indicator at Bottom */}
            <div className="mt-auto mb-4">
                <div
                    className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500'}`}
                    title={connectionState}
                />
            </div>
        </div>
    );
}
