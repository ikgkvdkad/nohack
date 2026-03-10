const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');
const SRC = path.join(__dirname, 'src');
const NATIVE_DIR = path.join(__dirname, 'node_modules', 'bluetooth-serial-port', 'build', 'Release');

// Clean
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

console.log('Building NoHack Relay...\n');

// 1. Rebuild native addon for node18 (to match pkg)
console.log('Rebuilding native addon for node18...');
execSync(
  'npx node-gyp rebuild --target=18.5.0 --directory=node_modules/bluetooth-serial-port',
  { stdio: 'inherit', cwd: __dirname }
);

// 2. Encode native .node files as base64
console.log('\nEncoding native bindings...');
const btSerial = fs.readFileSync(path.join(NATIVE_DIR, 'BluetoothSerialPort.node')).toString('base64');
const btServer = fs.readFileSync(path.join(NATIVE_DIR, 'BluetoothSerialPortServer.node')).toString('base64');
console.log(`  BluetoothSerialPort.node: ${Math.round(btSerial.length / 1024)}KB encoded`);
console.log(`  BluetoothSerialPortServer.node: ${Math.round(btServer.length / 1024)}KB encoded`);

// 3. Create bootstrap that extracts native addons then runs server
console.log('\nCreating bootstrap...');
const bootstrap = `
// ── NoHack Relay Bootstrap ───────────────────────────────────────────────────
// Extracts embedded native Bluetooth bindings and patches require() to find them
const fs = require('fs');
const path = require('path');
const os = require('os');

const NATIVE_DIR = path.join(os.tmpdir(), 'nohack-relay-native');
fs.mkdirSync(NATIVE_DIR, { recursive: true });

// Embedded native addons (base64)
const ADDONS = {
  'BluetoothSerialPort.node': '${btSerial}',
  'BluetoothSerialPortServer.node': '${btServer}',
};

// Extract to temp
for (const [name, b64] of Object.entries(ADDONS)) {
  const dest = path.join(NATIVE_DIR, name);
  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
    fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
  }
}

// Patch require resolution so bluetooth-serial-port finds the native addons
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  const basename = path.basename(request);
  if (basename === 'BluetoothSerialPort.node' || basename === 'BluetoothSerialPortServer.node') {
    const local = path.join(NATIVE_DIR, basename);
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, parent, ...rest);
};

// Now load the actual server
require('./src/server');
`;

// Write bootstrap to relay root so require('./src/server') resolves correctly
const bootstrapPath = path.join(__dirname, '_bootstrap.js');
fs.writeFileSync(bootstrapPath, bootstrap, 'utf8');

// 4. Compile with pkg
console.log('Compiling exe...');
execSync(
  `npx pkg _bootstrap.js --target node18-win-x64 --output dist/NoHackRelay.exe --compress GZip`,
  { stdio: 'inherit', cwd: __dirname }
);

// 5. Clean up
fs.unlinkSync(bootstrapPath);

// 6. Rebuild native addon back to node20 for dev
console.log('\nRestoring native addon for dev (node20)...');
execSync('npm rebuild bluetooth-serial-port', { stdio: 'inherit', cwd: __dirname });

const exePath = path.join(DIST, 'NoHackRelay.exe');
const size = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log('\nDone! Single file: ' + exePath + ' (' + size + 'MB)');
