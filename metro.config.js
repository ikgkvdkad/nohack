const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

const config = {
  resolver: {
    extraNodeModules: {
      net: path.resolve(__dirname, 'shims/net.js'),
      os: path.resolve(__dirname, 'shims/os.js'),
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
      buffer: require.resolve('buffer/'),
      util: require.resolve('util/'),
      path: require.resolve('path-browserify'),
      fs: path.resolve(__dirname, 'shims/fs.js'),
      constants: require.resolve('constants-browserify'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
