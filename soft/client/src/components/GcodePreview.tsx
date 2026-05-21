import React from 'react';

interface GcodePreviewProps {
    gcode: string;
}

const GcodePreview: React.FC<GcodePreviewProps> = ({ gcode }) => {
    return (
        <div style={{ marginTop: '20px' }}>
            <h3>G-code Preview</h3>
            <textarea
                readOnly
                value={gcode}
                style={{
                    width: '100%',
                    height: '300px',
                    background: '#111',
                    color: '#0f0',
                    fontFamily: 'monospace',
                    padding: '10px',
                    border: '1px solid #444'
                }}
            />
        </div>
    );
};

export default GcodePreview;
