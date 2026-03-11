import React, { useCallback } from 'react';

interface FileUploadProps {
    onFileLoaded: (name: string, content: string | File, type: 'vector' | 'raster') => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileLoaded }) => {
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const processFile = useCallback((file: File) => {
        const reader = new FileReader();

        if (file.type.includes('svg') || file.name.toLowerCase().endsWith('.svg')) {
            reader.onload = (event) => {
                const content = event.target?.result as string;
                onFileLoaded(file.name, content, 'vector');
            };
            reader.readAsText(file);
        } else if (file.name.toLowerCase().endsWith('.dxf')) {
            reader.onload = async (event) => {
                const content = event.target?.result as string;
                try {
                    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
                    const response = await fetch(`${apiUrl}/cam/parse-dxf`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fileContent: content })
                    });
                    const data = await response.json();
                    if (data.status === 'success') {
                        onFileLoaded(file.name, data.svg, 'vector');
                    } else {
                        alert('DXF Parse Error: ' + data.error);
                    }
                } catch (e: any) {
                    alert('Failed to parse DXF: ' + e.message);
                }
            };
            reader.readAsDataURL(file);
        } else if (file.name.toLowerCase().endsWith('.gcode') || file.name.toLowerCase().endsWith('.nc')) {
            reader.onload = (event) => {
                const content = event.target?.result as string;
                onFileLoaded(file.name, content, 'gcode' as any); // Use 'gcode' as custom type
            };
            reader.readAsText(file);
        } else if (file.type.includes('image') || file.name.match(/\.(png|jpe?g|webp|bmp)$/i)) {
            // Raster handling
            console.warn("Raster upload not fully implemented yet");
            onFileLoaded(file.name, file, 'raster');
        }
    }, [onFileLoaded]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            processFile(e.dataTransfer.files[0]);
        }
    }, [processFile]);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0]);
        }
    };

    return (
        <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={handleClick}
            className="hover:bg-white/5 transition-colors"
            style={{
                border: '2px dashed #666',
                borderRadius: '8px',
                padding: '40px',
                textAlign: 'center',
                color: '#aaa',
                cursor: 'pointer',
                marginBottom: '20px'
            }}
        >
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".gcode,.nc,.dxf,.svg,.jpg,.jpeg,.png,.bmp,.webp"
                onChange={handleFileSelect}
            />
            <p>Drag & Drop G-Code, DXF, SVG, or Image</p>
            <p className="text-xs mt-2 text-gray-500">(or click to browse)</p>
        </div>
    );
};

export default FileUpload;
