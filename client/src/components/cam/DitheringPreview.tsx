import React, { useRef, useEffect } from 'react';

interface Props {
    imageUrl: string;
    widthPx: number; // Physical width in pixels (or display width)
    heightPx: number;
    threshold: number;
    dither: boolean;
    mode: 'grayscale' | 'bw' | 'dither';
    invert: boolean;
}

export const DitheringPreview: React.FC<Props> = ({ imageUrl, widthPx, heightPx, threshold, dither, mode, invert }) => {
    // widthPx/heightPx unused for now in simplistic preview, but kept for future physical dimension overlay
    // console.log(widthPx, heightPx);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = imageUrl;
        img.onload = () => {
            // Set canvas size to display size (or process size?)
            // For preview, we want to see the effect.
            // If the image is huge, we might want to scale down for performance, 
            // but for "True" preview, we should match 1:1 if possible or zoom.
            // Let's stick to a reasonable max width for preview.

            const MAX_PREVIEW_WIDTH = 600;
            let renderWidth = img.width;
            let renderHeight = img.height;

            if (renderWidth > MAX_PREVIEW_WIDTH) {
                const ratio = MAX_PREVIEW_WIDTH / renderWidth;
                renderWidth = MAX_PREVIEW_WIDTH;
                renderHeight = img.height * ratio;
            }

            canvas.width = renderWidth;
            canvas.height = renderHeight;

            // Draw original
            ctx.drawImage(img, 0, 0, renderWidth, renderHeight);

            // Get Data
            const imageData = ctx.getImageData(0, 0, renderWidth, renderHeight);
            const data = imageData.data;

            // Apply Filters
            for (let i = 0; i < data.length; i += 4) {
                // Grayscale
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                let val = avg;

                // Thresholding (Clipping White)
                if (threshold < 255 && val > threshold) {
                    val = 255;
                }

                // Invert
                if (invert) {
                    val = 255 - val;
                }

                data[i] = val;
                data[i + 1] = val;
                data[i + 2] = val;
            }

            // Dithering (Floyd-Steinberg)
            if (mode === 'dither' || dither) { // Support legacy prop
                const width = renderWidth;
                const height = renderHeight;

                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const idx = (y * width + x) * 4;
                        const oldPixel = data[idx];
                        const newPixel = oldPixel < 128 ? 0 : 255;

                        data[idx] = newPixel;
                        data[idx + 1] = newPixel;
                        data[idx + 2] = newPixel;

                        const quantError = oldPixel - newPixel;

                        if (x + 1 < width) distributeError(data, (y * width + x + 1) * 4, quantError, 7 / 16);
                        if (x - 1 >= 0 && y + 1 < height) distributeError(data, ((y + 1) * width + x - 1) * 4, quantError, 3 / 16);
                        if (y + 1 < height) distributeError(data, ((y + 1) * width + x) * 4, quantError, 5 / 16);
                        if (x + 1 < width && y + 1 < height) distributeError(data, ((y + 1) * width + x + 1) * 4, quantError, 1 / 16);
                    }
                }
            }

            ctx.putImageData(imageData, 0, 0);
        };
    }, [imageUrl, threshold, dither, mode, invert]);

    const distributeError = (data: Uint8ClampedArray, idx: number, error: number, factor: number) => {
        const val = data[idx] + (error * factor);
        // data[] is clamped automatically, but good to be explicit/aware
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
    };

    return (
        <div className="border border-white/20 rounded overflow-hidden">
            <canvas ref={canvasRef} className="max-w-full h-auto" />
        </div>
    );
};
