import { describe, it, expect } from 'vitest';
import { PathAnalyzer } from '../src/cam/PathAnalyzer';

describe('PathAnalyzer.analyzeSvg', () => {
    const analyzer = new PathAnalyzer();

    it('flips Y and converts to mm', () => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50">
            <rect x="5" y="0" width="20" height="10" rx="2"/></svg>`;
        const [rect] = analyzer.analyzeSvg(svg);
        expect(rect.classification).toBe('rectangle');
        expect(rect.bounds.minX).toBeCloseTo(5);
        expect(rect.bounds.maxX).toBeCloseTo(25);
        expect(rect.bounds.minY).toBeCloseTo(40);
        expect(rect.bounds.maxY).toBeCloseTo(50);
    });

    it('treats unitless sizes as 96 DPI px', () => {
        const svg = `<svg width="96" height="96" viewBox="0 0 96 96"><path d="M0 0 H96"/></svg>`;
        const [p] = analyzer.analyzeSvg(svg);
        expect(p.bounds.maxX).toBeCloseTo(25.4);
        expect(p.bounds.minY).toBeCloseTo(25.4); // y=0 is the top
    });

    it('scales by viewBox ratio', () => {
        const svg = `<svg width="10cm" height="5cm" viewBox="0 0 200 100"><path d="M0 100 L200 100"/></svg>`;
        const [p] = analyzer.analyzeSvg(svg);
        expect(p.bounds.maxX).toBeCloseTo(100);
        expect(p.bounds.maxY).toBeCloseTo(0);
    });

    it('discretizes beziers and arcs instead of chording them', () => {
        const svg = `<svg width="100mm" height="100mm" viewBox="0 0 100 100">
            <path d="M 0 50 C 0 0 100 0 100 50"/>
            <path d="M 40 50 A 10 10 0 1 1 60 50 A 10 10 0 1 1 40 50 Z"/></svg>`;
        const [curve, circle] = analyzer.analyzeSvg(svg);
        expect(curve.points.length).toBe(17);
        // Cubic peaks at t=0.5: y = 50 - 37.5 (SVG) → 87.5 after flip
        expect(curve.bounds.maxY).toBeCloseTo(87.5, 1);
        expect(circle.closed).toBe(true);
        expect(circle.classification).toBe('closed_curve');
        expect(circle.bounds.width).toBeCloseTo(20, 1);
        expect(circle.bounds.height).toBeCloseTo(20, 1);
    });

    it('splits subpaths and handles implicit repeated coordinates', () => {
        const svg = `<svg width="10mm" height="10mm" viewBox="0 0 10 10"><path d="M0 0 1 0 1 1z M5 5 h2 v2 h-2 z"/></svg>`;
        const paths = analyzer.analyzeSvg(svg);
        expect(paths).toHaveLength(2);
        expect(paths[0].points).toHaveLength(4);
        expect(paths[1].bounds.minX).toBeCloseTo(5);
        expect(paths[1].bounds.maxY).toBeCloseTo(5);
    });
});
