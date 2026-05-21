import { useEffect, useRef } from 'react';

export function BackgroundFX() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Resize
        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        window.addEventListener('resize', resize);
        resize();

        // Particles (Metal Chips)
        const particles: { x: number; y: number; speed: number; size: number; rot: number; rotSpeed: number }[] = [];
        const maxParticles = 50;

        for (let i = 0; i < maxParticles; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                speed: 1 + Math.random() * 2,
                size: 1 + Math.random() * 3,
                rot: Math.random() * Math.PI,
                rotSpeed: (Math.random() - 0.5) * 0.1
            });
        }

        let animId: number;
        const animate = () => {
            if (!ctx || !canvas) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Styling for chips
            ctx.fillStyle = 'rgba(200, 200, 200, 0.2)'; // Silver, discrete
            ctx.strokeStyle = 'rgba(255, 215, 0, 0.1)'; // Slight Gold tint

            particles.forEach(p => {
                p.y += p.speed;
                p.rot += p.rotSpeed;

                if (p.y > canvas.height) {
                    p.y = -10;
                    p.x = Math.random() * canvas.width;
                }

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                // Draw discrete chip (irregular polygonish)
                ctx.beginPath();
                ctx.moveTo(-p.size, -p.size);
                ctx.lineTo(p.size, -p.size / 2);
                ctx.lineTo(0, p.size);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            });

            animId = requestAnimationFrame(animate);
        };
        animate();

        return () => {
            window.removeEventListener('resize', resize);
            cancelAnimationFrame(animId);
        };
    }, []);

    return (
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
            {/* Laser Beam Effect */}
            <div className="absolute top-0 bottom-0 left-0 w-[100px] opacity-20 bg-gradient-to-r from-[var(--accent-color)] to-transparent blur-3xl animate-pulse" />

            {/* Subtle moving beam */}
            <div className="absolute top-0 bottom-0 w-[2px] bg-white/10 blur-[1px] animate-[scan_10s_linear_infinite]"
                style={{ left: '10%' }}
            />

            <style>{`
            @keyframes scan {
                0% { left: 0%; opacity: 0; }
                10% { opacity: 0.6; }
                50% { opacity: 0.3; }
                90% { opacity: 0.6; }
                100% { left: 40%; opacity: 0; } 
            }
        `}</style>

            {/* Metal Chips Canvas */}
            <canvas ref={canvasRef} className="absolute inset-0" />
        </div>
    );
}
