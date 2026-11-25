import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface BackgroundLaserProps {
    delay?: number;
    spawnMode?: 'vertical' | 'flat'; // vertical = beam along local Y, flat = lying on the floor plane
    xRange?: number; // Scatter range along X
    zRange?: number; // Scatter range along Z
    height?: number; // Beam length
    particleSize?: number;
}

const SPARKS = 24;
const CYAN = new THREE.Color('#a5f3fc').multiplyScalar(1.4);
const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// One tiny soft-dot texture shared by every laser (round glowing sparks instead of square points)
let sparkTexture: THREE.Texture | null = null;
function getSparkTexture() {
    if (sparkTexture) return sparkTexture;
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(165,243,252,0.8)');
    grad.addColorStop(1, 'rgba(6,182,212,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    sparkTexture = new THREE.CanvasTexture(c);
    return sparkTexture;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface SparkBuffers { origin: Float32Array; vel: Float32Array; life: Float32Array; maxLife: Float32Array }
interface SparkData extends SparkBuffers { geo: THREE.BufferGeometry; pos: Float32Array; col: Float32Array }

function createSparks(): SparkData {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(SPARKS * 3);
    const col = new Float32Array(SPARKS * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return {
        geo, pos, col,
        origin: new Float32Array(SPARKS * 3),
        vel: new Float32Array(SPARKS * 3),
        life: new Float32Array(SPARKS),
        maxLife: new Float32Array(SPARKS),
    };
}

function spawnSpark({ origin, vel, life, maxLife }: SparkBuffers, i: number, height: number, initial: boolean) {
    // Along the beam, biased towards its middle; start right on the beam surface
    const along = (Math.random() + Math.random() - 1) * Math.min(height * 0.35, 600);
    const a = Math.random() * Math.PI * 2;
    const r = rand(0.5, 2);
    origin[i * 3] = Math.cos(a) * r;
    origin[i * 3 + 1] = along;
    origin[i * 3 + 2] = Math.sin(a) * r;
    // Drift slowly outwards, a little along the beam
    const out = rand(3, 10);
    vel[i * 3] = Math.cos(a) * out;
    vel[i * 3 + 1] = rand(-8, 8);
    vel[i * 3 + 2] = Math.sin(a) * out;
    maxLife[i] = rand(1.5, 3.5);
    life[i] = initial ? Math.random() * maxLife[i] : 0;
}

// Brightness fades in/out over each spark's life (additive blending, so black = invisible)
function stepSparks(sparks: SparkData, dt: number, fade: number, height: number) {
    const { pos, col, origin, vel, life, maxLife } = sparks;
    for (let i = 0; i < SPARKS; i++) {
        life[i] += dt;
        if (life[i] >= maxLife[i]) spawnSpark(sparks, i, height, false);
        const t = life[i];
        const b = Math.sin(Math.PI * t / maxLife[i]) * fade;
        pos[i * 3] = origin[i * 3] + vel[i * 3] * t;
        pos[i * 3 + 1] = origin[i * 3 + 1] + vel[i * 3 + 1] * t;
        pos[i * 3 + 2] = origin[i * 3 + 2] + vel[i * 3 + 2] * t;
        col[i * 3] = CYAN.r * b;
        col[i * 3 + 1] = CYAN.g * b;
        col[i * 3 + 2] = CYAN.b * b;
    }
    sparks.geo.attributes.position.needsUpdate = true;
    sparks.geo.attributes.color.needsUpdate = true;
}

/**
 * Decorative laser beam with sparks. Cheap by design: no React state, no post-processing
 * (the glow is a faint halo cylinder), nothing is drawn while the beam is off, and beams
 * appear rarely (every ~6-12 s, for ~2-3.5 s).
 */
export const BackgroundLaser = ({ delay = 0, spawnMode = 'vertical', xRange = 200, zRange = 200, height = 2000, particleSize = 3 }: BackgroundLaserProps) => {
    const groupRef = useRef<THREE.Group>(null);
    const coreMat = useRef<THREE.MeshBasicMaterial>(null);
    const haloMat = useRef<THREE.MeshBasicMaterial>(null);
    const st = useRef({ phase: 0 as 0 | 1 | 2 | 3, t: -delay, dur: rand(1, 4), clock: 0 }); // 0 off, 1 in, 2 on, 3 out

    const sparksRef = useRef<SparkData | null>(null);
    const pointsRef = useRef<THREE.Points>(null);
    useEffect(() => () => { sparksRef.current?.geo.dispose(); sparksRef.current = null; }, []);

    useFrame((_, dtRaw) => {
        const g = groupRef.current;
        if (!g || !pointsRef.current) return;
        let sparks = sparksRef.current;
        if (!sparks) {
            sparks = sparksRef.current = createSparks();
            pointsRef.current.geometry.dispose();
            pointsRef.current.geometry = sparks.geo;
        }
        const dt = Math.min(dtRaw, 0.1); // no jumps after a tab switch
        const s = st.current;
        s.t += dt;
        s.clock += dt;

        if (s.phase === 0) {
            if (g.visible) g.visible = false;
            if (s.t < s.dur || reducedMotion) return;
            const x = (Math.random() - 0.5) * xRange;
            const z = (Math.random() - 0.5) * zRange;
            g.position.set(x, 0, z);
            g.rotation.set(spawnMode === 'flat' ? Math.PI / 2 : 0, 0, spawnMode === 'flat' ? Math.random() * Math.PI : 0);
            for (let i = 0; i < SPARKS; i++) spawnSpark(sparks, i, height, true);
            g.visible = true;
            s.phase = 1; s.t = 0; s.dur = 0.8;
        } else if (s.t >= s.dur) {
            s.t = 0;
            if (s.phase === 1) { s.phase = 2; s.dur = rand(2, 3.5); }
            else if (s.phase === 2) { s.phase = 3; s.dur = 1.2; }
            else { s.phase = 0; s.dur = rand(6, 12); return; }
        }

        const k = s.phase === 1 ? s.t / s.dur : s.phase === 3 ? 1 - s.t / s.dur : 1;
        const fade = k * k * (3 - 2 * k); // smoothstep
        const flicker = 0.92 + 0.08 * Math.sin(s.clock * 23) * Math.sin(s.clock * 7.3);
        if (coreMat.current) coreMat.current.opacity = 0.85 * fade * flicker;
        if (haloMat.current) haloMat.current.opacity = 0.12 * fade;

        stepSparks(sparks, dt, fade, height);
    });

    return (
        <group ref={groupRef} visible={false}>
            <mesh>
                <cylinderGeometry args={[0.5, 0.5, height, 8, 1, true]} />
                <meshBasicMaterial ref={coreMat} color="#e0fbff" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
            <mesh>
                <cylinderGeometry args={[3, 3, height, 8, 1, true]} />
                <meshBasicMaterial ref={haloMat} color="#06b6d4" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <points ref={pointsRef} frustumCulled={false}>
                <pointsMaterial
                    size={particleSize}
                    map={getSparkTexture()}
                    vertexColors
                    transparent
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    sizeAttenuation
                />
            </points>
        </group>
    );
};
