import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';

interface Label3DProps {
    text: string;
    position: [number, number, number];
    color?: string;
    /** Height of the label in world units (mm) */
    size?: number;
    background?: string;
}

/** Camera-facing text sprite rendered with a canvas texture (no font download needed). */
const Label3D: React.FC<Label3DProps> = ({ text, position, color = '#e2e8f0', size = 6, background }) => {
    const { texture, aspect } = useMemo(() => {
        const px = 64;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        ctx.font = `600 ${px}px ui-monospace, Consolas, monospace`;
        const w = Math.ceil(ctx.measureText(text).width) + 24;
        canvas.width = w;
        canvas.height = px + 20;
        ctx.font = `600 ${px}px ui-monospace, Consolas, monospace`;
        if (background) {
            ctx.fillStyle = background;
            ctx.beginPath();
            ctx.roundRect(0, 0, canvas.width, canvas.height, 14);
            ctx.fill();
        }
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        return { texture: tex, aspect: canvas.width / canvas.height };
    }, [text, color, background]);

    useEffect(() => () => texture.dispose(), [texture]);

    return (
        <sprite position={position} scale={[size * aspect, size, 1]} renderOrder={10}>
            <spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
        </sprite>
    );
};

export default Label3D;
