// Stub for 'os' module — GramJS uses it for device info strings.
const {Platform} = require('react-native');
module.exports = {
  type: () => 'Android',
  hostname: () => 'nohack-relay',
  platform: () => Platform.OS,
  release: () => Platform.Version?.toString() || 'unknown',
};
