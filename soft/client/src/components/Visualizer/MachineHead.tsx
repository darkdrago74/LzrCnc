import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh } from 'three';

interface MachineHeadProps {
    x: number;
    y: number;
    z: number;
}

const MachineHead: React.FC<MachineHeadProps> = ({ x, y, z }) => {
    const meshRef = useRef<Mesh>(null);

    useFrame(() => {
        if (meshRef.current) {
            // Smooth lerp could be added here
            meshRef.current.position.set(x, y, z);
        }
    });

    return (
        <group>
            {/* The Tool Head */}
            <mesh ref={meshRef} position={[x, y, z]}>
                {/* Cone pointing down */}
                <coneGeometry args={[2, 10, 32]} />
                <meshStandardMaterial color="cyan" emissive="cyan" emissiveIntensity={0.5} />
            </mesh>

            {/* Ghost / Shadow on bed */}
            <mesh position={[x, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <ringGeometry args={[1, 1.5, 32]} />
                <meshBasicMaterial color="yellow" opacity={0.5} transparent />
            </mesh>
        </group>
    );
};

export default MachineHead;
