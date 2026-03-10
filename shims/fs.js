// Stub for Node's fs module — GramJS pulls in node-localstorage
// but we use StringSession so fs is never actually called
module.exports = {
  existsSync: () => false,
  readFileSync: () => '',
  writeFileSync: () => {},
  mkdirSync: () => {},
  readdirSync: () => [],
  unlinkSync: () => {},
  statSync: () => ({ isDirectory: () => false }),
  accessSync: () => {},
  constants: { F_OK: 0, R_OK: 4, W_OK: 2 },
};
