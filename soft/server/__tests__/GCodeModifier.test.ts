import { describe, it, expect } from 'vitest';
import { GCodeModifier } from '../src/cam/processors/GCodeModifier';

describe('GCodeModifier', () => {
    it('should scale X and Y correctly', () => {
        const modifier = new GCodeModifier();
        const gcode = `G90\nG0 X10 Y10`;
        const result = modifier.modify(gcode, { scaleX: 2, scaleY: 2 });
        expect(result).toContain('G0 X20.000 Y20.000');
    });

    it('should translate X and Y correctly', () => {
        const modifier = new GCodeModifier();
        const gcode = `G0 X10 Y10\nG1 X20 Y20`;
        const result = modifier.modify(gcode, { offsetX: 5, offsetY: -5 });
        expect(result).toContain('G0 X15.000 Y5.000');
        expect(result).toContain('G1 X25.000 Y15.000');
    });

    it('should handle feedrate overrides and scaling', () => {
        const modifier = new GCodeModifier();
        const gcode = `G1 X10 Y10 F1000`;
        const scaleLog = modifier.modify(gcode, { feedrateScale: 0.5 });
        expect(scaleLog).toContain('F500');

        const overrideLog = modifier.modify(gcode, { feedrateOverride: 300 });
        expect(overrideLog).toContain('F300');
    });

    it('should rotate coordinates correctly', () => {
        const modifier = new GCodeModifier();
        const gcode = `G90\nG0 X10 Y0`; // rotated 90 deg around origin -> X0 Y10
        const result = modifier.modify(gcode, { rotation: 90 });
        // The rotation math: X' = X*cos(90) - Y*sin(90) -> 0 - 0 = 0
        // wait, cos(90) = 0, sin(90) = 1
        // X = 10, Y = 0 -> X' = 10*0 - 0 = 0
        // Y' = X*sin(90) + Y*cos(90) -> 10*1 + 0 = 10
        expect(result).toContain('G0 X0.000 Y10.000');
    });
});
