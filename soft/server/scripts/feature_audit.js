const fs = require('fs');
const path = require('path');

const FEATURES_FILE = path.join(__dirname, 'features.json');
const ROOT_DIR = path.resolve(__dirname, '../../'); // Project Root
const OUTPUT_FILE = path.join(ROOT_DIR, 'feature_gap_report.md');

// Directories to scan (Server & Client src)
const SCAN_DIRS = [
    path.join(ROOT_DIR, 'server/src'),
    path.join(ROOT_DIR, 'client/src')
];

// Load Features
const features = JSON.parse(fs.readFileSync(FEATURES_FILE, 'utf8'));

// Helper: Recursive File Search
function getAllFiles(dirPath, arrayOfFiles) {
    if (!fs.existsSync(dirPath)) return arrayOfFiles || [];

    files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function (file) {
        // Skip node_modules and dotfiles
        if (file.startsWith('.') || file === 'node_modules') return;

        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        } else {
            // Only scan code files
            if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.json')) {
                arrayOfFiles.push(fullPath);
            }
        }
    });

    return arrayOfFiles;
}

// Load all file contents into memory (for simplicity in this scale)
console.log('Scanning codebase...');
let fileContents = [];
SCAN_DIRS.forEach(dir => {
    const files = getAllFiles(dir);
    files.forEach(f => {
        fileContents.push({
            path: f,
            content: fs.readFileSync(f, 'utf8').toLowerCase()
        });
    });
});

console.log(`Scanned ${fileContents.length} files.`);

// Audit Features
let report = `# LzrCnc Feature Gap Analysis\n\n`;
report += `**Generated:** ${new Date().toLocaleString()}\n\n`;
report += `| Category | Feature | Status | Evidence (Files) |\n`;
report += `|----------|---------|--------|------------------|\n`;

let missingCount = 0;
let partialCount = 0;
let implementedCount = 0;

features.forEach(feature => {
    let evidence = new Set();
    let score = 0;

    feature.keywords.forEach(kw => {
        fileContents.forEach(file => {
            if (file.content.includes(kw.toLowerCase())) {
                evidence.add(path.basename(file.path));
                score++;
            }
        });
    });

    let status = '❌ Missing';
    if (score > 5) status = '✅ Implemented'; // Arbitrary threshold
    else if (score > 0) status = '⚠️ Partial';

    if (status.includes('Missing')) missingCount++;
    if (status.includes('Partial')) partialCount++;
    if (status.includes('Implemented')) implementedCount++;

    const evidenceStr = Array.from(evidence).slice(0, 3).join(', ') + (evidence.size > 3 ? '...' : '');
    report += `| ${feature.category} | **${feature.name}** | ${status} | ${evidenceStr} |\n`;
});

report += `\n## Summary\n`;
report += `- **Implemented**: ${implementedCount}\n`;
report += `- **Partial**: ${partialCount}\n`;
report += `- **Missing**: ${missingCount}\n`;

fs.writeFileSync(OUTPUT_FILE, report);
console.log(`Report generated at: ${OUTPUT_FILE}`);
