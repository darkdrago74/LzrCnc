import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface MachineHeadProps {
    x: number;
    y: number;
    z: number;
    /** Spindle / laser power (S). When > 0 a beam is drawn from the tip to the bed. */
    power?: number;
}

const NOZZLE = 12;
const BODY_H = 30;
const BODY_R = 9;

/**
 * Tool head in native Z-up machine space: the nozzle tip sits exactly at (x, y, z) and points
 * down (-Z) towards the XY bed. The marker on the bed shows the XY position.
 */
const MachineHead: React.FC<MachineHeadProps> = ({ x, y, z, power = 0 }) => {
    const headRef = useRef<THREE.Group>(null);
    const markerRef = useRef<THREE.Group>(null);
    const beamRef = useRef<THREE.Mesh>(null);
    const target = useMemo(() => new THREE.Vector3(), []);

    useFrame((_, delta) => {
        target.set(x, y, z);
        const head = headRef.current;
        if (!head) return;
        // Exponential smoothing hides the status polling steps.
        const k = 1 - Math.exp(-delta * 18);
        if (head.position.distanceTo(target) > 200) head.position.copy(target);
        else head.position.lerp(target, k);
        if (markerRef.current) markerRef.current.position.set(head.position.x, head.position.y, 0.08);
        if (beamRef.current) {
            const h = Math.max(head.position.z, 0.01);
            beamRef.current.visible = power > 0 && head.position.z > 0;
            beamRef.current.scale.set(1, h, 1);
            beamRef.current.position.set(head.position.x, head.position.y, h / 2);
        }
    });

    return (
        <group>
            <group ref={headRef} position={[x, y, z]}>
                {/* Nozzle: cone rotated so its apex points to -Z, apex at the group origin */}
                <mesh position={[0, 0, NOZZLE / 2]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
                    <coneGeometry args={[4, NOZZLE, 32]} />
                    <meshStandardMaterial color="#22d3ee" metalness={0.4} roughness={0.35} emissive="#0e7490" emissiveIntensity={0.4} />
                </mesh>
                <mesh position={[0, 0, NOZZLE + BODY_H / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                    <cylinderGeometry args={[BODY_R, BODY_R, BODY_H, 32]} />
                    <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
                </mesh>
                <mesh position={[0, 0, NOZZLE + BODY_H + 1]} rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[BODY_R + 1, BODY_R + 1, 2, 32]} />
                    <meshStandardMaterial color="#0891b2" />
                </mesh>
            </group>

            {/* Laser beam (unit height along Z, scaled each frame) */}
            <mesh ref={beamRef} visible={false} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.35, 0.35, 1, 8]} />
                <meshBasicMaterial color="#ff2d55" transparent opacity={0.85} toneMapped={false} />
            </mesh>

            {/* Flat crosshair on the XY bed */}
            <group ref={markerRef} position={[x, y, 0.08]}>
                <mesh>
                    <ringGeometry args={[2.5, 3.2, 40]} />
                    <meshBasicMaterial color="#f59e0b" transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} />
                </mesh>
                <lineSegments>
                    <bufferGeometry>
                        <bufferAttribute attach="attributes-position" args={[new Float32Array([-6, 0, 0, 6, 0, 0, 0, -6, 0, 0, 6, 0]), 3]} />
                    </bufferGeometry>
                    <lineBasicMaterial color="#f59e0b" />
                </lineSegments>
            </group>
        </group>
    );
};

export default MachineHead;
