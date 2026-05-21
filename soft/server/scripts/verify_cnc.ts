import ClipperLib from 'js-clipper';

// Mock Logic from CncService
function testOffsetAndGcode() {
    console.log("Testing CNC 2.5D Logic...");

    // 1. Create a Square 10x10mm
    // Clipper scales by 1000
    const SCALE = 1000;
    const path = [
        { X: 0 * SCALE, Y: 0 * SCALE },
        { X: 10 * SCALE, Y: 0 * SCALE },
        { X: 10 * SCALE, Y: 10 * SCALE },
        { X: 0 * SCALE, Y: 10 * SCALE }
    ];

    console.log("Input Path: 10x10 Square");

    // 2. Test Offset (Outside Profile, Tool D=3.175mm -> Radius ~1.58mm)
    const toolDiameter = 3.175;
    const toolRadius = (toolDiameter / 2) * SCALE;

    const co = new ClipperLib.ClipperOffset();
    co.AddPaths([path], ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);

    const solution = new ClipperLib.Paths();
    co.Execute(solution, toolRadius);

    if (solution.length !== 1) {
        console.error("❌ Offset failed: Expected 1 path, got " + solution.length);
        return;
    }

    const bounds = getBounds(solution[0], SCALE);
    console.log(`Offset Bounds: W${bounds.w.toFixed(3)} x H${bounds.h.toFixed(3)}`);

    // Expected: 10 + 3.175 = 13.175 (-ish due to corner rounding)
    // Actually, offset adds Radius to *both* sides? 
    // Square 0-10. Center shifts? 
    // Left side 0 -> -1.58. Right side 10 -> 11.58. Total Width = 13.175.

    const expectedDim = 10 + toolDiameter;
    if (Math.abs(bounds.w - expectedDim) < 0.1) {
        console.log("✅ Offset Dimension Correct");
    } else {
        console.error(`❌ Offset Dimension Mismatch. Expected ${expectedDim}, got ${bounds.w}`);
    }

    // 3. Test Step Down Logic
    const cutDepth = 5.0; // mm
    const stepDown = 2.0; // mm

    console.log(`Testing Step Down: Target ${cutDepth}mm, Step ${stepDown}mm`);
    let depth = 0;
    let layers = 0;
    while (depth < cutDepth) {
        depth += stepDown;
        if (depth > cutDepth) depth = cutDepth;
        layers++;
        console.log(`Layer ${layers}: Z -${depth.toFixed(2)}`);
    }

    if (layers === 3 && depth === 5.0) {
        console.log("✅ Step Down Layers Correct (2mm, 4mm, 5mm)");
    } else {
        console.error("❌ Step Down Logic Incorrect");
    }
}

function getBounds(path: any[], scale: number) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    path.forEach(p => {
        if (p.X < minX) minX = p.X;
        if (p.X > maxX) maxX = p.X;
        if (p.Y < minY) minY = p.Y;
        if (p.Y > maxY) maxY = p.Y;
    });
    return {
        w: (maxX - minX) / scale,
        h: (maxY - minY) / scale
    };
}

testOffsetAndGcode();
