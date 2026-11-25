import { useId } from 'react';

/**
 * Vector LzrCnc brand: the triangle "LC" mark (thick left leg = L, beam through the apex,
 * C in the middle) and the wordmark with a laser line. Replaces the 7 MB logo.png.
 */
export function LogoMark({ size = 32, glow = true, className = '' }: { size?: number; glow?: boolean; className?: string }) {
    const id = useId().replace(/:/g, '');
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
            <defs>
                <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#a5f3fc" />
                    <stop offset="1" stopColor="#06b6d4" />
                </linearGradient>
                <filter id={`${id}f`} x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="1.6" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
            </defs>
            <g filter={glow ? `url(#${id}f)` : undefined} strokeLinejoin="round" strokeLinecap="round">
                {/* L: thick left leg + bottom */}
                <path d="M29.5 9 L4 56 H29.5 V50.5 H13.5 L29.5 21 Z" fill={`url(#${id}g)`} />
                {/* thin right leg */}
                <path d="M34.5 9 L60 56 H38" fill="none" stroke={`url(#${id}g)`} strokeWidth="2.2" />
                {/* C */}
                <path d="M45.5 33 H36.5 a4.5 4.5 0 0 0 -4.5 4.5 V46.5 a4.5 4.5 0 0 0 4.5 4.5 H45.5" fill="none" stroke="#67e8f9" strokeWidth="5" />
                {/* laser beam through the apex */}
                <path d="M32 2 V62" stroke="#ecfeff" strokeWidth="1" opacity="0.9" />
            </g>
        </svg>
    );
}

export function BrandLogo({ className = '' }: { className?: string }) {
    return (
        <div className={`lzr-brand select-none ${className}`} aria-label="LzrCnc">
            <LogoMark size={36} />
            <div className="relative leading-none">
                <span className="lzr-wordmark">
                    <span className="text-slate-100">Lzr</span><span className="text-cyan-300">Cnc</span>
                </span>
                <span className="lzr-beam" aria-hidden="true" />
            </div>
        </div>
    );
}
