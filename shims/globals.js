// This file is loaded before all other modules via Metro's getPolyfills
// It ensures Buffer and process are globally available for GramJS
const {Buffer} = require('buffer');
if (typeof global !== 'undefined') {
  global.Buffer = global.Buffer || Buffer;
  global.process = global.process || {env: {}, version: '', platform: 'android'};
  global.process.env = global.process.env || {};
}
