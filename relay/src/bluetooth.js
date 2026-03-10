const { BluetoothSerialPort } = require('bluetooth-serial-port');
const EventEmitter = require('events');

class BluetoothRelay extends EventEmitter {
  constructor() {
    super();
    this.bt = null;
    this.connected = false;
    this.running = false;
    this.buffer = '';
    this.targetAddress = null;
    this._loopId = 0; // guards against duplicate loops
  }

  // ── Connection loop ──────────────────────────────────────────────────────

  async connect(address) {
    // Stop any existing loop first
    this.running = false;
    this.connected = false;
    if (this.bt) {
      try { this.bt.close(); } catch {}
      this.bt = null;
    }

    this.targetAddress = address;
    this.running = true;
    this._loopId++;
    this._connectionLoop(this._loopId);
  }

  disconnect() {
    this.running = false;
    this.connected = false;
    this._loopId++;
    if (this.bt) {
      try { this.bt.close(); } catch {}
      this.bt = null;
    }
    this.emit('disconnected');
  }

  async _connectionLoop(myId) {
    while (this.running && this._loopId === myId) {
      try {
        this.bt = new BluetoothSerialPort();
        this.buffer = '';
        this.connected = false;

        this.emit('log', 'Finding NoHack device...');
        const channel = await this._findChannel(this.targetAddress);
        if (this._loopId !== myId) break;

        this.emit('log', `Found on channel ${channel}, connecting...`);
        await this._connectToChannel(this.targetAddress, channel);
        if (this._loopId !== myId) break;

        this.connected = true;
        this.emit('connected');
        this.emit('log', 'Connected to NoHack!');

        this.bt.on('data', (raw) => this._handleData(raw));

        // Wait for disconnect
        await new Promise((resolve) => {
          this.bt.on('closed', () => {
            this.emit('log', 'Connection closed.');
            this.connected = false;
            this.emit('disconnected');
            resolve();
          });
          this.bt.on('failure', (err) => {
            this.emit('log', `Connection error: ${err}`);
            this.connected = false;
            this.emit('disconnected');
            resolve();
          });
        });

        try { this.bt.close(); } catch {}
        this.bt = null;

        if (this.running && this._loopId === myId) {
          this.emit('log', 'Reconnecting in 3 seconds...');
          await this._sleep(3000);
        }
      } catch (err) {
        try { if (this.bt) this.bt.close(); } catch {}
        this.bt = null;
        this.connected = false;

        if (this.running && this._loopId === myId) {
          this.emit('log', `Connection failed: ${err.message}. Retrying in 5 seconds...`);
          this.emit('disconnected');
          await this._sleep(5000);
        }
      }
    }
  }

  // ── Send data ────────────────────────────────────────────────────────────

  send(data) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.bt) {
        reject(new Error('Not connected'));
        return;
      }
      this.bt.write(Buffer.from(data, 'utf8'), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // ── Device discovery ─────────────────────────────────────────────────────

  listPairedDevices() {
    return new Promise((resolve, reject) => {
      const bt = new BluetoothSerialPort();
      bt.listPairedDevices((devices) => {
        resolve(devices.map(d => ({
          name: d.name || 'Unknown',
          address: d.address,
        })));
      });
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  isConnected() {
    return this.connected;
  }

  _findChannel(address) {
    return new Promise((resolve, reject) => {
      this.bt.findSerialPortChannel(address, (channel) => {
        resolve(channel);
      }, () => {
        reject(new Error('Could not find RFCOMM channel'));
      });
    });
  }

  _connectToChannel(address, channel) {
    return new Promise((resolve, reject) => {
      this.bt.connect(address, channel, () => {
        resolve();
      }, (err) => {
        reject(new Error(err || 'Connection failed'));
      });
    });
  }

  _handleData(rawBuffer) {
    this.buffer += rawBuffer.toString('utf8');
    const parts = this.buffer.split('\n');
    this.buffer = parts.pop(); // keep incomplete last part

    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const response = JSON.parse(trimmed);
        this.emit('data', response);
      } catch {
        this.emit('log', `Malformed data: ${trimmed.substring(0, 80)}`);
      }
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BluetoothRelay;
