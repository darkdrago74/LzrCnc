const makerjs = require('makerjs');
console.log('MakerJS Exports Keys:', Object.keys(makerjs));
console.log('Has importer?', !!makerjs.importer);
if (makerjs.importer) {
    console.log('Importer Keys:', Object.keys(makerjs.importer));
}
if (makerjs.exporter) {
    console.log('Exporter Keys:', Object.keys(makerjs.exporter));
}
