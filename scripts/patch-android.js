#!/usr/bin/env node
/**
 * Patches third-party native libraries after npm install so they compile
 * against modern SDK / React Native versions.
 *
 * Run automatically via the "postinstall" npm script.
 */
const fs = require('fs');
const path = require('path');

const nodeModules = path.join(__dirname, '..', 'node_modules');

// ── Simple string replacements ──────────────────────────────────────────────
const replacements = [
  {
    file: 'react-native-bluetooth-classic/android/build.gradle',
    pairs: [
      ['compileSdkVersion 29', 'compileSdkVersion 34'],
      ['buildToolsVersion "28.0.3"', 'buildToolsVersion "34.0.0"'],
      ['targetSdkVersion 29', 'targetSdkVersion 34'],
    ],
  },
  {
    // Remove the invalid @Override on hasConstants() – the method was
    // removed from ReactContextBaseJavaModule in RN 0.73+.
    file: 'react-native-bluetooth-classic/android/src/main/java/kjd/reactnative/bluetooth/RNBluetoothClassicModule.java',
    pairs: [
      ['@Override\n    public boolean hasConstants', 'public boolean hasConstants'],
      // Handle Windows-style line endings too
      ['@Override\r\n    public boolean hasConstants', 'public boolean hasConstants'],
    ],
  },
];

for (const {file, pairs} of replacements) {
  const filePath = path.join(nodeModules, file);
  if (!fs.existsSync(filePath)) {
    console.log(`[patch] skip (not found): ${file}`);
    continue;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  for (const [from, to] of pairs) {
    content = content.replaceAll(from, to);
  }
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[patch] patched: ${file}`);
}
