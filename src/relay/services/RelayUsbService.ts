import {NativeModules, NativeEventEmitter} from 'react-native';
import {extractLines, parseTransportLine, serializeForTransport} from '../../utils/nohack';
import type {TransportResponse} from '../../types';

const {UsbHost, ForegroundService} = NativeModules;

type Listener<T> = (arg: T) => void;

class RelayUsbService {
  private buffer = '';
  private running = false;
  private emitterSub: any = null;
  private statusSub: any = null;
  private connected = false;

  private dataListeners: Listener<TransportResponse>[] = [];
  private statusListeners: Listener<'connected' | 'disconnected'>[] = [];
  private logListeners: Listener<string>[] = [];
  private deviceNameListeners: Listener<string>[] = [];

  // ── Event subscriptions ───────────────────────────────────────────────────

  onData(cb: Listener<TransportResponse>) {
    this.dataListeners.push(cb);
    return () => { this.dataListeners = this.dataListeners.filter(l => l !== cb); };
  }

  onStatusChange(cb: Listener<'connected' | 'disconnected'>) {
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

  // ── Start/Stop ──────────────────────────────────────────────────────────────

  async start() {
    if (this.running) return;
    this.running = true;
    this.buffer = '';

    try { ForegroundService?.start(); } catch {}

    const emitter = new NativeEventEmitter(UsbHost);

    this.statusSub = emitter.addListener('usbStatus', (status: string) => {
      if (status === 'connected') {
        this.connected = true;
        this.buffer = '';
        this.emitStatus('connected');
        this.emitLog('USB connected to NoHack!');
        // Send ping to get the NoHack's name
        this.send(serializeForTransport({cmd: 'ping'}));
      } else {
        this.connected = false;
        this.emitStatus('disconnected');
        this.emitLog('USB disconnected');
      }
    });

    this.emitterSub = emitter.addListener('usbData', (data: string) => {
      this.handleData(data);
    });

    await UsbHost.start();
    this.emitLog('Waiting for USB connection...');
  }

  disconnect() {
    this.running = false;
    try { ForegroundService?.stop(); } catch {}
    this.emitterSub?.remove();
    this.statusSub?.remove();
    this.emitterSub = null;
    this.statusSub = null;
    UsbHost?.stop();
    this.connected = false;
    this.emitStatus('disconnected');
  }

  // ── Data handling ─────────────────────────────────────────────────────────

  private handleData(chunk: string) {
    this.buffer += chunk;
    const {lines, remaining} = extractLines(this.buffer);
    this.buffer = remaining;

    for (const line of lines) {
      const parsed = parseTransportLine(line);
      if (parsed && 'cmd' in parsed) {
        const response = parsed as TransportResponse;
        if (response.cmd === 'ack' && response.deviceName) {
          this.deviceNameListeners.forEach(l => l(response.deviceName!));
        }
        this.dataListeners.forEach(l => l(response));
      }
    }
  }

  // ── Send to device ────────────────────────────────────────────────────────

  async send(data: string): Promise<boolean> {
    if (!this.connected) return false;
    try {
      return await UsbHost.write(data);
    } catch { return false; }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private emitStatus(s: 'connected' | 'disconnected') {
    this.statusListeners.forEach(l => l(s));
  }
  private emitLog(msg: string) {
    this.logListeners.forEach(l => l(msg));
  }
}

export default new RelayUsbService();
