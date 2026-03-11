import DxfParser from 'dxf-parser';
import * as makerjs from 'makerjs';

export class DxfConverter {
    async convertToSvg(dxfContent: string): Promise<string> {
        let parser;
        // dxf-parser sometimes exports as default or module.exports based on node version
        if (typeof DxfParser === 'function') {
            parser = new DxfParser();
        } else if ((DxfParser as any).default) {
            parser = new (DxfParser as any).default();
        } else {
            // fallback
            const parserClass = require('dxf-parser');
            parser = new parserClass();
        }

        try {
            const dxf = parser.parseSync(dxfContent);
            if (!dxf || !dxf.entities) {
                throw new Error("Invalid DXF or no entities found");
            }
            const model = this.buildMakerJsModel(dxf);
            const svg = makerjs.exporter.toSVG(model, {
                useSvgPathOnly: false,
                stroke: 'cyan',
                strokeWidth: '1px'
            });
            return svg;
        } catch (e: any) {
            console.error("Error parsing DXF:", e);
            throw new Error('Failed to parse DXF: ' + e.message);
        }
    }

    private buildMakerJsModel(dxf: any): makerjs.IModel {
        const rootModel: makerjs.IModel = { models: {}, paths: {} };
        let i = 0;

        for (const entity of dxf.entities) {
            if (entity.type === 'LINE') {
                rootModel.paths![`line_${i++}`] = new makerjs.paths.Line(
                    [entity.vertices[0].x, entity.vertices[0].y],
                    [entity.vertices[1].x, entity.vertices[1].y]
                );
            } else if (entity.type === 'CIRCLE') {
                rootModel.paths![`circle_${i++}`] = new makerjs.paths.Circle(
                    [entity.center.x, entity.center.y],
                    entity.radius
                );
            } else if (entity.type === 'ARC') {
                // dxf-parser startAngle and endAngle are in radians
                const startDeg = entity.startAngle * (180 / Math.PI);
                const endDeg = entity.endAngle * (180 / Math.PI);
                rootModel.paths![`arc_${i++}`] = new makerjs.paths.Arc(
                    [entity.center.x, entity.center.y],
                    entity.radius,
                    startDeg,
                    endDeg
                );
            } else if (entity.type === 'POLYLINE' || entity.type === 'LWPOLYLINE') {
                if (entity.vertices && entity.vertices.length > 0) {
                    const points = entity.vertices.map((v: any) => [v.x, v.y]);
                    const isClosed = entity.shape || entity.closed || false;
                    const polyModel = new makerjs.models.ConnectTheDots(isClosed, points);
                    rootModel.models![`poly_${i++}`] = polyModel;
                }
            } else if (entity.type === 'SPLINE') {
                if (entity.controlPoints && entity.controlPoints.length > 0) {
                    const points = entity.controlPoints.map((v: any) => [v.x, v.y]);
                    const isClosed = entity.closed || false;
                    const splineModel = new makerjs.models.ConnectTheDots(isClosed, points);
                    rootModel.models![`spline_${i++}`] = splineModel;
                }
            }
        }

        return rootModel;
    }
}
