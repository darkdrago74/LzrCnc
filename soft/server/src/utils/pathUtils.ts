import path from 'path';
import fs from 'fs';

export function resolvePath(relativePathFromRoot: string): string {
    const cwd = process.cwd();
    // Try ./relative
    const probe = path.join(cwd, relativePathFromRoot);
    if (fs.existsSync(probe)) {
        return probe;
    }
    // Try ../relative (common if running from server/ dir)
    const probeParent = path.join(cwd, '..', relativePathFromRoot);
    if (fs.existsSync(probeParent)) {
        return probeParent;
    }
    // Fallback
    return probe;
}

export function getProjectRoot(): string {
    const cwd = process.cwd();
    if (fs.existsSync(path.join(cwd, 'install.sh'))) return cwd;
    if (fs.existsSync(path.join(cwd, '..', 'install.sh'))) return path.join(cwd, '..');
    return cwd;
}
