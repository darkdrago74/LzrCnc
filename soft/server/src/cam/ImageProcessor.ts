import sharp from 'sharp';

export class ImageProcessor {

    /**
     * Pre-processes an image for raster engraving.
     * 1. Resize to physical dimensions (resolution).
     * 2. Grayscale.
     * 3. Optional: Threshold/Clipping (make near-white pure white).
     * 4. Optional: Dithering (Floyd-Steinberg).
     */
    async processForRaster(
        filePath: string,
        widthPx: number,
        heightPx: number,
        dither: boolean,
        threshold: number = 250 // 0-255, pixels brighter than this become 255
    ): Promise<{ data: Buffer, info: sharp.OutputInfo }> {

        let pipeline = sharp(filePath)
            .grayscale()
            .resize(widthPx, heightPx, { fit: 'fill' });

        // Get raw buffer to perform manual pixel manipulation for thresholding & dithering
        const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });

        // Apply Thresholding (Clipping White)
        // If a pixel is > threshold, make it 255 (paper white / laser off)
        if (threshold < 255) {
            for (let i = 0; i < data.length; i++) {
                if (data[i] >= threshold) {
                    data[i] = 255;
                }
            }
        }

        // Apply Dithering if requested
        if (dither) {
            this.floydSteinbergDither(data, info.width, info.height);
        }

        return { data, info };
    }

    private floydSteinbergDither(pixels: Buffer, width: number, height: number) {
        // Work in floating point so diffused error can go below 0 / above 255 without wrapping.
        const buf = new Float32Array(pixels.length);
        for (let i = 0; i < pixels.length; i++) buf[i] = pixels[i];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const oldPixel = buf[idx];
                const newPixel = oldPixel < 128 ? 0 : 255;
                buf[idx] = newPixel;
                const quantError = oldPixel - newPixel;
                if (x + 1 < width) buf[idx + 1] += (quantError * 7) / 16;
                if (y + 1 < height) {
                    if (x > 0) buf[idx + width - 1] += (quantError * 3) / 16;
                    buf[idx + width] += (quantError * 5) / 16;
                    if (x + 1 < width) buf[idx + width + 1] += quantError / 16;
                }
            }
        }
        for (let i = 0; i < pixels.length; i++) pixels[i] = buf[i];
    }
}
