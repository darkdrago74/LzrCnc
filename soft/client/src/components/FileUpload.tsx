import React, { useCallback, useState } from 'react';
import { Upload } from 'lucide-react';
import { apiPost } from '../api';

export type UploadKind = 'vector' | 'raster' | 'gcode';

interface FileUploadProps {
    onFileLoaded: (name: string, content: string | File, type: UploadKind, extra?: { dxfSource?: string }) => void;
}

const readText = (file: File) => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
});

const FileUpload: React.FC<FileUploadProps> = ({ onFileLoaded }) => {
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);
    const [busy, setBusy] = useState(false);

    const processFile = useCallback(async (file: File) => {
        const name = file.name;
        const lower = name.toLowerCase();
        setBusy(true);
        try {
            if (lower.endsWith('.svg') || file.type.includes('svg')) {
                onFileLoaded(name, await readText(file), 'vector');
            } else if (lower.endsWith('.dxf')) {
                const dxf = await readText(file);
                const data = await apiPost<{ status: string; svg: string; error?: string }>('/cam/parse-dxf', { fileContent: dxf });
                onFileLoaded(name, data.svg, 'vector', { dxfSource: dxf });
            } else if (/\.(gcode|nc|ngc|gc|tap)$/.test(lower)) {
                onFileLoaded(name, await readText(file), 'gcode');
            } else if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/.test(lower)) {
                onFileLoaded(name, file, 'raster');
            } else {
                alert(`Unsupported file type: ${name}`);
            }
        } catch (e) {
            alert(`Could not load ${name}: ${(e as Error).message}`);
        } finally {
            setBusy(false);
        }
    }, [onFileLoaded]);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        Array.from(e.dataTransfer.files).forEach(processFile);
    };

    return (
        <div
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg px-4 py-6 text-center cursor-pointer transition-colors ${dragging ? 'border-cyan-400 bg-cyan-500/10' : 'border-white/15 hover:border-cyan-500/50 hover:bg-white/5'}`}
        >
            <input
                type="file"
                multiple
                ref={fileInputRef}
                className="hidden"
                accept=".gcode,.nc,.ngc,.gc,.tap,.dxf,.svg,.jpg,.jpeg,.png,.bmp,.webp,.gif"
                onChange={e => { Array.from(e.target.files ?? []).forEach(processFile); e.target.value = ''; }}
            />
            <Upload size={20} className={`mx-auto mb-2 ${busy ? 'animate-bounce text-cyan-300' : 'text-gray-500'}`} />
            <p className="text-sm text-gray-300">{busy ? 'Loading…' : 'Drop SVG, DXF, image or G-code'}</p>
            <p className="text-[11px] mt-1 text-gray-500">or click to browse</p>
        </div>
    );
};

export default FileUpload;
