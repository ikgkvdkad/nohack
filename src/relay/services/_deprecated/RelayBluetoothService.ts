import {NativeModules} from 'react-native';
import RNBluetoothClassic from 'react-native-bluetooth-classic';
import {extractLines, parseBluetoothLine, serializeForBluetooth} from '../../utils/enigma';
import type {BluetoothResponse} from '../../types';

const {ForegroundService} = NativeModules;

type Listener<T> = (arg: T) => void;

class RelayBluetoothService {
  private device: any = null;
  private buffer = '';
  private running = false;
  private loopId = 0;
  private dataSubscription: any = null;

  private dataListeners: Listener<BluetoothResponse>[] = [];
  private statusListeners: Listener<'connecting' | 'connected' | 'disconnected'>[] = [];
  private logListeners: Listener<string>[] = [];
  private deviceNameListeners: Listener<string>[] = [];

  // ── Event subscriptions ───────────────────────────────────────────────────

  onData(cb: Listener<BluetoothResponse>) {
    this.dataListeners.push(cb);
    return () => { this.dataListeners = this.dataListeners.filter(l => l !== cb); };
  }

  onStatusChange(cb: Listener<'connecting' | 'connected' | 'disconnected'>) {
    this.statusListeners.push(cb);
    return () => { this.statusListeners = this.statusListeners.filter(l => l !== cb); };
  }

  onLog(cb: Listener<string>) {
    this.logListeners.push(cb);
    return () => { this.logListeners = this.logListeners.filter(l => l !== cb); };
  }

  onDeviceName(cb: Listener<string>) {
    this.deviceNameListeners.push(cb);
    return () => { this.deviceNameListeners = this.deviceNameListeners.filter(l => l !== cb); };
  }

  // ── List bonded devices ───────────────────────────────────────────────────

  async listBondedDevices(): Promise<{name: string; address: string}[]> {
    const devices = await RNBluetoothClassic.getBondedDevices();
    return devices.map(d => ({
      name: d.name || 'Unknown',
      address: d.address,
    }));
  }

  // ── Connection loop ───────────────────────────────────────────────────────

  async connect(address: string) {
    this.running = false;
    if (this.device) {
      try { await this.device.disconnect(); } catch {}
      this.device = null;
    }
    this.dataSubscription?.remove();
    this.dataSubscription = null;

    this.running = true;
    this.loopId++;
    try { ForegroundService?.start(); } catch {}
    this.connectionLoop(address, this.loopId);
  }

  disconnect() {
    this.running = false;
    this.loopId++;
    try { ForegroundService?.stop(); } catch {}
    this.dataSubscription?.remove();
    this.dataSubscription = null;
    if (this.device) {
      try { this.device.disconnect(); } catch {}
      this.device = null;
    }
    this.emitStatus('disconnected');
  }

  private async connectionLoop(address: string, myId: number) {
    while (this.running && this.loopId === myId) {
      try {
        this.emitStatus('connecting');
        this.emitLog('Connecting to NoHack...');
        this.buffer = '';

        const dev = await RNBluetoothClassic.connectToDevice(address, {});
        if (this.loopId !== myId) break;

        this.device = dev;
        this.emitStatus('connected');
        this.emitLog('Connected!');

        // Subscribe to incoming data
        this.dataSubscription = dev.onDataReceived((event: any) => {
          this.handleData(event.data as string);
        });

        // Send ping to get the NoHack's real name
        await this.send(serializeForBluetooth({cmd: 'ping'}));

        // Wait for disconnect
        await new Promise<void>(resolve => {
          const poll = setInterval(async () => {
            if (this.loopId !== myId) { clearInterval(poll); resolve(); return; }
            try {
              const connected = await dev.isConnected();
              if (!connected) { clearInterval(poll); resolve(); }
            } catch { clearInterval(poll); resolve(); }
          }, 2000);
        });

        this.dataSubscription?.remove();
        this.dataSubscription = null;
        this.device = null;

        if (this.running && this.loopId === myId) {
          this.emitStatus('disconnected');
          this.emitLog('Connection lost. Reconnecting in 3s...');
          await this.sleep(3000);
        }
      } catch (err: any) {
        this.dataSubscription?.remove();
        this.dataSubscription = null;
        this.device = null;

        if (this.running && this.loopId === myId) {
          this.emitLog(`Connection failed: ${err.message}. Retrying in 5s...`);
          this.emitStatus('disconnected');
          await this.sleep(5000);
        }
      }
    }
  }

  // ── Data handling ─────────────────────────────────────────────────────────

  private handleData(chunk: string) {
    this.buffer += chunk;
    const {lines, remaining} = extractLines(this.buffer);
    this.buffer = remaining;

    for (const line of lines) {
      const parsed = parseBluetoothLine(line);
      if (parsed && 'cmd' in parsed) {
        const response = parsed as BluetoothResponse;
        if (response.cmd === 'ack' && response.deviceName) {
          this.deviceNameListeners.forEach(l => l(response.deviceName!));
        }
        this.dataListeners.forEach(l => l(response));
      }
    }
  }

  // ── Send to device ────────────────────────────────────────────────────────

  async send(data: string): Promise<boolean> {
    if (!this.device) return false;
    try {
      await this.device.write(data);
      return true;
    } catch { return false; }
  }

  isConnected(): boolean {
    return this.device !== null;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private emitStatus(s: 'connecting' | 'connected' | 'disconnected') {
    this.statusListeners.forEach(l => l(s));
  }
  private emitLog(msg: string) {
    this.logListeners.forEach(l => l(msg));
  }
  private sleep(ms: number) {
    return new Promise<void>(r => setTimeout(r, ms));
  }
}

export default new RelayBluetoothService();
