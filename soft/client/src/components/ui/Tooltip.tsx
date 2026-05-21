import React, { useState } from 'react';

interface TooltipProps {
    content: string;
    children: React.ReactNode;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children }) => {
    const [isVisible, setIsVisible] = useState(false);

    return (
        <div
            className="relative inline-block"
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            {isVisible && (
                <div className="absolute z-50 px-2 py-1 text-xs text-white bg-black/90 border border-white/20 rounded shadow-lg -top-8 left-1/2 transform -translate-x-1/2 whitespace-nowrap pointer-events-none">
                    {content}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-black/90"></div>
                </div>
            )}
        </div>
    );
};

export const HelpIcon: React.FC<{ text: string }> = ({ text }) => (
    <Tooltip content={text}>
        <div className="w-4 h-4 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-[10px] text-gray-400 cursor-help border border-white/10">
            ?
        </div>
    </Tooltip>
);
