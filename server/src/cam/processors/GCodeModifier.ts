export interface GCodeModifierOptions {
    offsetX?: number;
    offsetY?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number; // In degrees
    feedrateScale?: number;
    feedrateOverride?: number;
}

export class GCodeModifier {
    modify(gcode: string, options: GCodeModifierOptions): string {
        const lines = gcode.split('\n');
        const modifiedLines: string[] = [];

        // Modal State Variables
        let isAbsolute = true; // G90 vs G91. Usually default is G90
        let currentX = 0;
        let currentY = 0;

        const {
            offsetX = 0,
            offsetY = 0,
            scaleX = 1,
            scaleY = 1,
            rotation = 0,
            feedrateScale,
            feedrateOverride
        } = options;

        const rotRad = rotation * (Math.PI / 180);
        const cosR = Math.cos(rotRad);
        const sinR = Math.sin(rotRad);

        // Transforms an absolute point (x,y)
        const transformPoint = (x: number, y: number) => {
            // Scale
            let sx = x * scaleX;
            let sy = y * scaleY;
            // Rotate around (0,0)
            let rx = sx * cosR - sy * sinR;
            let ry = sx * sinR + sy * cosR;
            // Translate
            return {
                x: rx + offsetX,
                y: ry + offsetY
            };
        };

        for (let line of lines) {
            const originalLine = line.trim();
            if (originalLine.length === 0) {
                modifiedLines.push(line);
                continue;
            }

            let comment = '';
            let codePart = originalLine;
            const commentIdx = originalLine.indexOf(';');
            if (commentIdx !== -1) {
                comment = originalLine.substring(commentIdx);
                codePart = originalLine.substring(0, commentIdx).trim();
            }

            if (codePart.length === 0) {
                modifiedLines.push(originalLine);
                continue;
            }

            const words = codePart.toUpperCase().split(/\s+/);
            const modifiedWords: string[] = [];

            let hasMove = false;
            let targetX = currentX;
            let targetY = currentY;

            // First pass: extract state changes and target positions
            for (const word of words) {
                const letter = word.charAt(0);
                const valueStr = word.substring(1);
                const value = parseFloat(valueStr);

                if (isNaN(value)) continue;

                if (letter === 'G' && value === 90) isAbsolute = true;
                if (letter === 'G' && value === 91) isAbsolute = false;

                if (letter === 'X') {
                    targetX = isAbsolute ? value : currentX + value;
                    hasMove = true;
                }
                if (letter === 'Y') {
                    targetY = isAbsolute ? value : currentY + value;
                    hasMove = true;
                }
            }

            // Calculate new transformed targets
            let oldTransformed = transformPoint(currentX, currentY);
            let newTransformed = transformPoint(targetX, targetY);

            // Second pass: rebuild line
            for (const word of words) {
                const letter = word.charAt(0);
                const valueStr = word.substring(1);
                const value = parseFloat(valueStr);

                if (isNaN(value)) {
                    modifiedWords.push(word);
                    continue;
                }

                if (letter === 'X') {
                    if (isAbsolute) {
                        modifiedWords.push(`X${newTransformed.x.toFixed(3)}`);
                    } else {
                        modifiedWords.push(`X${(newTransformed.x - oldTransformed.x).toFixed(3)}`);
                    }
                } else if (letter === 'Y') {
                    if (isAbsolute) {
                        modifiedWords.push(`Y${newTransformed.y.toFixed(3)}`);
                    } else {
                        modifiedWords.push(`Y${(newTransformed.y - oldTransformed.y).toFixed(3)}`);
                    }
                } else if (letter === 'F') {
                    if (feedrateOverride !== undefined) {
                        modifiedWords.push(`F${feedrateOverride}`);
                    } else if (feedrateScale !== undefined && feedrateScale !== 1) {
                        const newF = Math.round(value * feedrateScale);
                        modifiedWords.push(`F${newF}`);
                    } else {
                        modifiedWords.push(word);
                    }
                } else {
                    modifiedWords.push(word);
                }
            }

            // Update modal state
            if (hasMove) {
                currentX = targetX;
                currentY = targetY;
            }

            let newLine = modifiedWords.join(' ');
            if (comment) {
                newLine = newLine.length > 0 ? `${newLine} ${comment}` : comment;
            }
            modifiedLines.push(newLine);
        }

        return modifiedLines.join('\n');
    }
}
