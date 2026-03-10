import {NativeModules, NativeEventEmitter} from 'react-native';
import {TransportCommand, TransportResponse} from '../types';
import {serializeForTransport, parseTransportLine, extractLines} from '../utils/nohack';

const {UsbConnection, ForegroundService} = NativeModules;

type Listener<T> = (arg: T) => void;

const MAX_BUFFER_SIZE = 1024 * 1024; // 1 MB — drop connection if exceeded

class UsbService {
  private buffer: string = '';
  private running: boolean = false;
  private emitterSub: any = null;
  private statusSub: any = null;
  private connected: boolean = false;

  private commandListeners: Listener<TransportCommand>[] = [];
  private statusListeners: Listener<'connected' | 'disconnected'>[] = [];

  // ── Event subscriptions ─────────────────────────────────────────────────────

  onCommand(cb: Listener<TransportCommand>) {
    this.commandListeners.push(cb);
    return () => {
      this.commandListeners = this.commandListeners.filter(l => l !== cb);
    };
  }

  onStatusChange(cb: Listener<'connected' | 'disconnected'>) {
    this.statusListeners.push(cb);
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== cb);
    };
  }

  private emitCommand(cmd: TransportCommand) {
    this.commandListeners.forEach(l => l(cmd));
  }

  private emitStatus(status: 'connected' | 'disconnected') {
    this.connected = status === 'connected';
    this.statusListeners.forEach(l => l(status));
  }

  // ── Start/Stop ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log('[UsbService] Starting USB listener');

    try { ForegroundService?.start(); } catch {}

    const emitter = new NativeEventEmitter(UsbConnection);

    this.statusSub = emitter.addListener('usbStatus', (status: string) => {
      console.log('[UsbService] USB status:', status);
      if (status === 'connected') {
        this.buffer = '';
        this.emitStatus('connected');
      } else {
        this.emitStatus('disconnected');
      }
    });

    this.emitterSub = emitter.addListener('usbData', (data: string) => {
      this.handleData(data);
    });

    await UsbConnection.start();
  }

  stop() {
    this.running = false;
    try { ForegroundService?.stop(); } catch {}
    this.emitterSub?.remove();
    this.statusSub?.remove();
    this.emitterSub = null;
    this.statusSub = null;
    UsbConnection?.stop();
    this.connected = false;
  }

  // ── Data handling ─────────────────────────────────────────────────────────────

  private handleData(chunk: string) {
    this.buffer += chunk;

    // Prevent memory exhaustion from malicious/malformed data
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      console.warn('[UsbService] Buffer exceeded 1 MB — dropping');
      this.buffer = '';
      return;
    }

    const {lines, remaining} = extractLines(this.buffer);
    this.buffer = remaining;

    for (const line of lines) {
      const parsed = parseTransportLine(line);
      if (parsed && 'cmd' in parsed) {
        if (parsed.cmd === 'decrypt' || parsed.cmd === 'introduction' || parsed.cmd === 'ping' || parsed.cmd === 'identify') {
          this.emitCommand(parsed as TransportCommand);
        }
      }
    }
  }

  // ── Send response ───────────────────────────────────────────────────────────

  async sendResponse(response: TransportResponse): Promise<boolean> {
    if (!this.connected) return false;
    try {
      return await UsbConnection.write(serializeForTransport(response));
    } catch {
      return false;
    }
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  isConnected(): boolean {
    return this.connected;
  }

  isRunning(): boolean {
    return this.running;
  }
}

export default new UsbService();
