import { GCodeModifier } from './src/cam/processors/GCodeModifier.js';

const gcode = `
; Header
G90
G0 X10 Y10 F1000
G1 X20 Y20 F500
G91
G1 X5 Y5
G90
M5
`;

const modifier = new GCodeModifier();

const test1 = modifier.modify(gcode, { offsetX: 50, offsetY: 25 });
console.log("--- TEST 1: Offset X=50, Y=25 ---");
console.log(test1);

const test2 = modifier.modify(gcode, { feedrateScale: 0.5 });
console.log("\n--- TEST 2: Feedrate Scale = 0.5 ---");
console.log(test2);

const test3 = modifier.modify(gcode, { feedrateOverride: 300 });
console.log("\n--- TEST 3: Feedrate Override = 300 ---");
console.log(test3);

const test4 = modifier.modify(gcode, { scaleX: 2, scaleY: 2, rotation: 90 });
console.log("\n--- TEST 4: Scale 2x, Rotate 90 ---");
console.log(test4);

