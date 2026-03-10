// Buffer polyfill needed by tweetnacl-util and other deps
import {Buffer} from 'buffer';
global.Buffer = Buffer;
if (typeof globalThis !== 'undefined') globalThis.Buffer = Buffer;

// TextEncoder polyfill needed by react-native-qrcode-svg on Hermes
if (typeof global.TextEncoder === 'undefined') {
  const {TextEncoder, TextDecoder} = require('text-encoding');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
