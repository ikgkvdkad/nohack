// Stub for 'net' module — GramJS imports it but won't use it when
// configured with PromisedWebSockets (WebSocket transport).
module.exports = {
  Socket: class Socket {},
  connect: () => {},
  createConnection: () => {},
  createServer: () => {},
};
