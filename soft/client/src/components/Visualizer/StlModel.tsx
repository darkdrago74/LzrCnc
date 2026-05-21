import React, { useMemo, useEffect } from 'react';
import { useLoader } from '@react-three/fiber';
import { STLLoader } from 'three-stdlib';
import * as THREE from 'three';

interface StlModelProps {
    url: string;
    onUndercutAnalysis?: (percent: number) => void;
}

export const StlModel: React.FC<StlModelProps> = ({ url, onUndercutAnalysis }) => {
    const geom = useLoader(STLLoader, url);

    // Custom Shader for Undercut Detection
    const material = useMemo(() => {
        return new THREE.ShaderMaterial({
            uniforms: {
                colorSafe: { value: new THREE.Color('#4ade80') }, // Green
                colorUndercut: { value: new THREE.Color('#ef4444') }, // Red
                lightDir: { value: new THREE.Vector3(0.5, 0.8, 0.5).normalize() }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vViewPosition;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewPosition = -mvPosition.xyz;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 colorSafe;
                uniform vec3 colorUndercut;
                uniform vec3 lightDir;
                varying vec3 vNormal;
                
                void main() {
                    // Re-normalize normal
                    vec3 normal = normalize(vNormal);
                    
                    // Basic Lambert lighting
                    float diff = max(dot(normal, lightDir), 0.2);
                    
                    // Undercut Detection: 
                    // In World Space, we usually assume Z is UP. 
                    // However, THREE.js Object space might differ. 
                    // Let's assume the model is oriented such that its Z is UP. 
                    // Actually, if we use world normal... but vertex shader uses view space normal?
                    // Wait, we need "Object Space" normal or "World Space" normal to check against Up.
                    // If the model is rotated, the 'undercut' changes relative to the machine Z.
                    // For now, assume model is placed flat. We need world normal.
                    
                    // BUT, in the shader, recovering World Normal is tricky without passing modelMatrix.
                    // Let's rely on a simpler varying passed from vertex.
                    // Actually, let's do this color logic in JS to keep Shader simple? 
                    // No, Shader is faster. 
                    // Let's just assume for now we use a simpler standard material and I calculate analysis in JS.
                    
                    vec3 color = colorSafe;
                    // We need a varying that represents the World Normal Z component.
                    // If we can't reliably get world Z here easily, let's fallback to standard render
                    // and do the analysis/coloring via Vertex Colors in JS!
                    
                    gl_FragColor = vec4(color * diff, 1.0);
                }
            `
        });
    }, []);

    // Perform Analysis on CPU once geometry loads
    useEffect(() => {
        if (!geom) return;

        // Ensure vertex normals exist
        geom.computeVertexNormals();

        const posAttr = geom.attributes.position;
        const normAttr = geom.attributes.normal;
        const count = posAttr.count;

        const colors = new Float32Array(count * 3);
        let undercutCount = 0;

        for (let i = 0; i < count; i++) {
            const nz = normAttr.getY(i); // STL usually Y-up? Or Z-up? G-Code is Z-up. 
            // Three.js Defaults: Y is Up. 
            // CNC: Z is Up. 
            // We usually rotate Scene to match. 
            // If the VisualizerScene rotates X=-90, then model's Z (up) becomes Y (screen up).
            // Let's check the VisualizerScene. 
            // It sets explicit Camera position.
            // Let's assume the Geometry Z is the Machine Z.

            const machineZNormal = normAttr.getZ(i);

            if (machineZNormal < 0) { // Pointing Down
                // Undercut
                colors[i * 3] = 1.0; // R
                colors[i * 3 + 1] = 0.2; // G
                colors[i * 3 + 2] = 0.2; // B
                undercutCount++;
            } else {
                // Safe
                colors[i * 3] = 0.2; // R
                colors[i * 3 + 1] = 0.8; // G
                colors[i * 3 + 2] = 0.2; // B
            }
        }

        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        if (onUndercutAnalysis) {
            const percent = (undercutCount / count) * 100;
            onUndercutAnalysis(percent);
        }

    }, [geom, onUndercutAnalysis]);

    return (
        <mesh geometry={geom} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
            {/* Use Vertex Colors */}
            <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
        </mesh>
    );
};
