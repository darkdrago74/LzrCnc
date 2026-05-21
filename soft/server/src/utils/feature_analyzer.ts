import fs from 'fs';
import path from 'path';

// Current Baseline from LaserWeb4
const LASERWEB4_FEATURES = [
    { category: 'CAM', id: 'raster', name: 'Raster Image Support', keywords: ['RasterProcessor', 'dither', 'potrace'] },
    { category: 'CAM', id: 'vector', name: 'Vector Support', keywords: ['VectorProcessor', 'DxfConverter', 'svg'] },
    { category: 'CAM', id: 'material', name: 'Materials Library', keywords: ['MaterialsPanel', 'MaterialService'] },
    { category: 'CAM', id: 'gcode_mod', name: 'G-Code Modifiers (Scale/Rotate/Offset)', keywords: ['GCodeModifier', 'scaleX', 'rotation'] },
    { category: 'Control', id: 'connect', name: 'Machine Connection', keywords: ['GrblController', 'KlipperController', 'serialport', 'websocket'] },
    { category: 'Control', id: 'jog', name: 'Jogging', keywords: ['jog(', 'dist, feedrate'] },
    { category: 'Control', id: 'home', name: 'Homing', keywords: ['homing(', '$H', 'G28'] },
    { category: 'Control', id: 'probe', name: 'Z-Probe', keywords: ['probe(', 'G38.2'] },
    { category: 'Control', id: 'macros', name: 'Macros', keywords: ['MacroPanel', 'Custom Macros'] },
    { category: 'Control', id: 'terminal', name: 'Terminal', keywords: ['Terminal.tsx', 'logs'] },
    { category: 'UI', id: 'dnd', name: 'Drag & Drop', keywords: ['FileUpload', 'onDragDrop'] },
    { category: 'UI', id: 'visualizer', name: 'Visualizer (3D)', keywords: ['VisualizerScene', 'THREE'] }
];

function scanDirectory(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            // Ignore node_modules, dist, .git
            if (!['node_modules', 'dist', '.git'].includes(file)) {
                scanDirectory(fullPath, fileList);
            }
        } else {
            // Only care about ts, tsx, js
            if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx') || fullPath.endsWith('.js')) {
                fileList.push(fullPath);
            }
        }
    }
    return fileList;
}

async function analyze() {
    console.log('Starting Feature Analysis...');

    // __dirname is .../LzrCnc/server/src/utils
    // Scan Server (.../LzrCnc/server/src)
    const serverFiles = scanDirectory(path.resolve(__dirname, '..'));
    // Scan Client (.../LzrCnc/client/src)
    const clientFiles = scanDirectory(path.resolve(__dirname, '../../../client/src'));

    const allFiles = [...serverFiles, ...clientFiles];

    const results = LASERWEB4_FEATURES.map(feat => {
        let matchCount = 0;
        let matchedFiles: string[] = [];

        for (const file of allFiles) {
            const content = fs.readFileSync(file, 'utf8');
            let hasMatch = false;
            for (const keyword of feat.keywords) {
                if (content.includes(keyword)) {
                    hasMatch = true;
                    matchCount++;
                }
            }
            if (hasMatch) {
                matchedFiles.push(path.basename(file));
            }
        }

        // Deduplicate files
        matchedFiles = [...new Set(matchedFiles)];

        // Determine status
        let status = '❌ Missing';
        if (matchedFiles.length >= 2) status = '✅ Implemented';
        else if (matchedFiles.length === 1) status = '⚠️ Partial';

        return {
            ...feat,
            status,
            files: matchedFiles.slice(0, 3).join(', ') + (matchedFiles.length > 3 ? '...' : '')
        };
    });

    // Generate Markdown Report
    const dateStr = new Date().toLocaleString();
    let md = `# LzrCnc Automated Feature Gap Analysis\n\n**Generated:** ${dateStr}\n\n`;
    md += `| Category | Feature | Status | Evidence (Files) |\n`;
    md += `|----------|---------|--------|------------------|\n`;

    let implemented = 0, partial = 0, missing = 0;

    results.forEach(r => {
        md += `| ${r.category} | **${r.name}** | ${r.status} | ${r.files} |\n`;
        if (r.status.includes('✅')) implemented++;
        if (r.status.includes('⚠️')) partial++;
        if (r.status.includes('❌')) missing++;
    });

    md += `\n## Summary\n`;
    md += `- **Implemented**: ${implemented}\n`;
    md += `- **Partial**: ${partial}\n`;
    md += `- **Missing**: ${missing}\n`;

    // Write out the fresh report to the project root
    const outPath = path.resolve(__dirname, '../../../feature_gap_report.md');
    fs.writeFileSync(outPath, md);

    console.log(`Analysis complete. Wrote ${outPath}`);
    console.log(`Summary: Implemented: ${implemented}, Partial: ${partial}, Missing: ${missing}`);
}

analyze().catch(console.error);
