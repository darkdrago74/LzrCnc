declare module 'makerjs' {
    export namespace importer {
        function fromSVG(svg: string): IModel;
        function fromDXF(dxf: string): IModel;
    }
    export namespace exporter {
        interface IGCodeOptions {
            units?: string;
            feed?: number;
        }
        function toGCode(model: IModel, options?: IGCodeOptions): string;
    }
    export interface IModel {
        paths?: any;
        models?: any;
    }
}
