import { useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface BackgroundLaserProps {
    delay?: number;
    spawnMode?: 'vertical' | 'flat'; // vertical = Y-aligned falling, flat = X/Z aligned
    xRange?: number; // Scatter range along X
    zRange?: number; // Scatter range along Z
    height?: number; // Beam length
    particleSize?: number; // Size of particles
}

export const BackgroundLaser = ({ delay = 0, spawnMode = 'vertical', xRange = 200, zRange = 200, height = 2000, particleSize = 3 }: BackgroundLaserProps) => {
    const groupRef = useRef<THREE.Group>(null);
    const beamRef = useRef<THREE.Mesh>(null);
    const particlesRef = useRef<THREE.Points>(null);

    // Animation State
    const [cycleState, setCycleState] = useState<'HIDDEN' | 'FADE_IN' | 'VISIBLE' | 'FADE_OUT'>('HIDDEN');
    const timer = useRef(0);
    const opacity = useRef(0);
    const initialDelay = useRef(delay);

    // Constants
    const CYCLE_Duration = {
        HIDDEN: 1.0,
        FADE_IN: 0.5,
        VISIBLE: 3.5, // Longer visibility
        FADE_OUT: 0.5
    };

    // Particles Data
    const particleCount = 50;
    const particlesGeometry = useMemo(() => {
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 10; // Width Scatter
            positions[i * 3 + 1] = (Math.random() - 0.5) * height; // Length (Y)
            positions[i * 3 + 2] = (Math.random() - 0.5) * 10; // Depth Scatter
            sizes[i] = Math.random() * 3;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        return geo;
    }, [height]);

    useFrame((_, delta) => {
        if (initialDelay.current > 0) {
            initialDelay.current -= delta;
            return;
        }

        timer.current += delta;

        // Lifecycle Logic
        switch (cycleState) {
            case 'HIDDEN':
                opacity.current = 0;
                if (timer.current > CYCLE_Duration.HIDDEN) {
                    if (groupRef.current) {
                        // Reset Position Logic
                        const x = (Math.random() - 0.5) * xRange;
                        const z = (Math.random() - 0.5) * zRange;

                        // Default to center
                        groupRef.current.position.set(0, 0, 0);
                        groupRef.current.rotation.set(0, 0, 0);

                        if (spawnMode === 'vertical') {
                            // Rain falling: Random X/Z, fixed Y (handled by parent or center)
                            groupRef.current.position.set(x, 0, z);
                        } else {
                            // Flat
                            groupRef.current.position.set(x, 0, z);
                            groupRef.current.rotation.x = Math.PI / 2;
                            groupRef.current.rotation.z = Math.random() * Math.PI; // Random angle on floor
                        }
                    }
                    timer.current = 0;
                    setCycleState('FADE_IN');
                }
                break;

            case 'FADE_IN':
                opacity.current = Math.min(1, timer.current / CYCLE_Duration.FADE_IN);
                if (timer.current > CYCLE_Duration.FADE_IN) {
                    timer.current = 0;
                    setCycleState('VISIBLE');
                }
                break;

            case 'VISIBLE':
                opacity.current = 1;
                if (timer.current > CYCLE_Duration.VISIBLE) {
                    timer.current = 0;
                    setCycleState('FADE_OUT');
                }
                break;

            case 'FADE_OUT':
                opacity.current = Math.max(0, 1 - (timer.current / CYCLE_Duration.FADE_OUT));
                if (timer.current > CYCLE_Duration.FADE_OUT) {
                    timer.current = 0;
                    setCycleState('HIDDEN');
                }
                break;
        }

        // Particle Animation (Falling Down for Vertical, Sliding for Flat)
        if (particlesRef.current && cycleState !== 'HIDDEN') {
            const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;
            // Downward speed (-Y)
            const speed = -500 * delta; // Fast "Laser Speed"

            for (let i = 0; i < particleCount; i++) {
                positions[i * 3 + 1] += speed;

                // Loop
                if (positions[i * 3 + 1] < -height / 2) {
                    positions[i * 3 + 1] = height / 2;
                }
            }
            particlesRef.current.geometry.attributes.position.needsUpdate = true;
        }

        // Opacity Update
        if (beamRef.current) (beamRef.current.material as THREE.Material).opacity = opacity.current;
        if (particlesRef.current) (particlesRef.current.material as THREE.Material).opacity = opacity.current;
    });

    return (
        <group ref={groupRef}>
            {/* Cylinder Geometry - Y Aligned Default */}
            <mesh ref={beamRef}>
                <cylinderGeometry args={[0.6, 0.6, height, 16]} />
                <meshBasicMaterial
                    color="#00FFFF"
                    transparent
                    opacity={0}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                />
            </mesh>

            <points ref={particlesRef} geometry={particlesGeometry}>
                <pointsMaterial
                    size={particleSize}
                    color="#00ffff"
                    transparent
                    opacity={0}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    sizeAttenuation={true}
                />
            </points>
        </group>
    );
};
