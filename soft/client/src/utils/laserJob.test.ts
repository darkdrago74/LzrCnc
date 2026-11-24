import { describe, it, expect } from 'vitest';
import { objectTransform, resolveOperation, defaultOperation, SKIP_OPERATION } from './laserJob';
import { getBedExtents } from './machineGeometry';
import type { SceneObject } from '../types';

const obj = (over: Partial<SceneObject> = {}): SceneObject => ({
    id: 'a', name: 'a', type: 'file', content: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    position: [100, 50, 0], rotation: [0, 0, 0], scale: [1, 1, 1], ...over,
});

describe('objectTransform', () => {
    it('rotates counter-clockwise in degrees around the object center (Y up)', () => {
        const tf = objectTransform(obj({ rotation: [0, 0, 90] }));
        const [x, y] = tf(10, 0);
        expect(x).toBeCloseTo(100);
        expect(y).toBeCloseTo(60);
    });

    it('applies scale before rotation and translation', () => {
        const tf = objectTransform(obj({ scale: [2, 3, 1] }));
        expect(tf(1, 1)).toEqual([102, 53]);
    });
});

describe('resolveOperation', () => {
    const raster = defaultOperation('raster');
    const cut = defaultOperation('vector_cut');

    it('routes images to raster and SVGs to vector operations', () => {
        expect(resolveOperation(obj({ type: 'image', content: 'blob:x' }), [cut, raster])?.id).toBe(raster.id);
        expect(resolveOperation(obj(), [raster, cut])?.id).toBe(cut.id);
    });

    it('honours an explicit assignment', () => {
        expect(resolveOperation(obj({ operationId: raster.id }), [cut, raster])?.id).toBe(raster.id);
    });

    it('skips disabled operations', () => {
        expect(resolveOperation(obj(), [{ ...cut, enabled: false }])).toBeUndefined();
    });

    it("never burns an object assigned to 'none'", () => {
        expect(resolveOperation(obj({ operationId: SKIP_OPERATION }), [cut, raster])).toBeUndefined();
    });
});

describe('getBedExtents', () => {
    it('places the bed in negative Y for a top-left origin', () => {
        const b = getBedExtents({ workbench: { width: 400, height: 300, origin: 'top-left' } } as never);
        expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([0, 400, -300, 0]);
        expect(b.centerY).toBe(-150);
    });
});
