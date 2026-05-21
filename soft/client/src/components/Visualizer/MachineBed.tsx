import React from 'react';
import { Text, Grid } from '@react-three/drei';
import * as THREE from 'three';

interface MachineBedProps {
    limits?: {
        x: { min: number, max: number };
        y: { min: number, max: number };
        z: { min: number, max: number };
    };
    width?: number;
    height?: number;
    visible?: boolean;
    origin?: 'bottom-left' | 'top-left' | 'top-right' | 'bottom-right';
}

const MachineBed: React.FC<MachineBedProps & { axesSettings?: any }> = ({ limits, width, height, visible = true, origin = 'bottom-left', axesSettings }) => {
    // defaults: prioritize passed width/height, then limits, then 200 fallback
    const xMax = width || limits?.x?.max || 200;
    const yMax = height || limits?.y?.max || 200;

    // Calculate Offset based on Origin
    let xOffset = xMax / 2;
    let yOffset = yMax / 2;

    if (origin === 'top-left') {
        xOffset = xMax / 2;
        yOffset = -yMax / 2;
    } else if (origin === 'top-right') {
        xOffset = -xMax / 2;
        yOffset = -yMax / 2;
    } else if (origin === 'bottom-right') {
        xOffset = -xMax / 2;
        yOffset = yMax / 2;
    }

    // Arrow Logic
    const arrowLength = 40;
    const xDir = new THREE.Vector3(axesSettings?.x?.reversed ? -1 : 1, 0, 0);
    const yDir = new THREE.Vector3(0, axesSettings?.y?.reversed ? -1 : 1, 0);
    const zDir = new THREE.Vector3(0, 0, axesSettings?.z?.reversed ? -1 : 1);

    const xColor = axesSettings?.x?.reversed ? '#ff6b6b' : 'red';
    const yColor = axesSettings?.y?.reversed ? '#69db7c' : 'green';
    const zColor = axesSettings?.z?.reversed ? '#4dabf7' : 'blue';

    return (
        <group>
            {visible && (
                <>
                    {/* Outer Grid */}
                    <Grid
                        position={[xOffset, yOffset, -0.05]}
                        args={[xMax, yMax]}
                        rotation={[Math.PI / 2, 0, 0]}
                        cellSize={50}
                        sectionSize={100}
                        sectionColor="#003366"
                        cellColor="#003366"
                        sectionThickness={1.0}
                        cellThickness={0.6}
                        infiniteGrid
                        fadeDistance={1200}
                    />

                    {/* Inner Grid */}
                    <Grid
                        position={[xOffset, yOffset, 0.1]}
                        args={[xMax, yMax]}
                        rotation={[Math.PI / 2, 0, 0]}
                        cellSize={50}
                        sectionSize={100}
                        sectionColor="#06b6d4"
                        cellColor="#1e3a8a"
                        sectionThickness={1.0}
                        cellThickness={0.5}
                        infiniteGrid={false}
                    />

                    {/* Physical Bed */}
                    <mesh position={[xOffset, yOffset, -0.5]} receiveShadow>
                        <planeGeometry args={[xMax, yMax]} />
                        <meshStandardMaterial color="#e5e7eb" roughness={0.5} metalness={0.1} />
                    </mesh>

                    {/* Bed Border */}
                    <lineSegments position={[xOffset, yOffset, 0]}>
                        <edgesGeometry args={[new THREE.BoxGeometry(xMax, yMax, 1)]} />
                        <lineBasicMaterial color="#06b6d4" linewidth={2} toneMapped={false} />
                    </lineSegments>
                </>
            )}

            {/* Dynamic Axes Arrows */}
            {/* X */}
            <arrowHelper args={[xDir, new THREE.Vector3(0, 0, 0), arrowLength, xColor, 10, 5]} />
            <Text position={[xDir.x * (arrowLength + 5), 0, 0]} fontSize={8} color={xColor} anchorX="center" anchorY="middle">
                X
            </Text>

            {/* Y */}
            <arrowHelper args={[yDir, new THREE.Vector3(0, 0, 0), arrowLength, yColor, 10, 5]} />
            <Text position={[0, yDir.y * (arrowLength + 5), 0]} fontSize={8} color={yColor} anchorX="center" anchorY="middle">
                Y
            </Text>

            {/* Z */}
            <arrowHelper args={[zDir, new THREE.Vector3(0, 0, 0), arrowLength, zColor, 10, 5]} />
            <Text position={[0, 0, zDir.z * (arrowLength + 5)]} fontSize={8} color={zColor} anchorX="center" anchorY="middle">
                Z
            </Text>

            {/* Box Origin Marker */}
            <mesh position={[0, 0, 0]}>
                <boxGeometry args={[4, 4, 4]} />
                <meshStandardMaterial color="white" />
            </mesh>
        </group>
    );
};

export default MachineBed;
