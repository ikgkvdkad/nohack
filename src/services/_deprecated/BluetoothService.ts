import {NativeModules} from 'react-native';
import RNBluetoothClassic from 'react-native-bluetooth-classic';
import {BluetoothCommand, BluetoothResponse} from '../types';
import {serializeForBluetooth, parseBluetoothLine, extractLines} from '../utils/enigma';

const {ForegroundService} = NativeModules;

type Listener<T> = (arg: T) => void;

class BluetoothService {
  private device: any = null;
  private buffer: string = '';
  private dataSubscription: any = null;
  private disconnectSubscription: any = null;
  private running: boolean = false;

  private commandListeners: Listener<BluetoothCommand>[] = [];
  private statusListeners: Listener<'connected' | 'disconnected'>[] = [];

  // ── Event subscriptions ─────────────────────────────────────────────────────

  onCommand(cb: Listener<BluetoothCommand>) {
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

  private emitCommand(cmd: BluetoothCommand) {
    this.commandListeners.forEach(l => l(cmd));
  }

  private emitStatus(status: 'connected' | 'disconnected') {
    this.statusListeners.forEach(l => l(status));
  }

  // ── Always-on accept loop ─────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log('[BluetoothService] Starting always-on accept loop');
    // Start foreground service to keep Bluetooth alive with screen off
    try { ForegroundService?.start(); } catch {}
    // Cancel any lingering accept from a previous JS session (e.g. hot reload)
    try { await RNBluetoothClassic.cancelAccept(); } catch {}
    this.acceptLoop();
  }

  private async acceptLoop(): Promise<void> {
    while (this.running) {
      try {
        if (this.device) {
          try { this.device.disconnect(); } catch {}
          this.cleanup();
          this.emitStatus('disconnected');
        }

        // Always cancel lingering accept before re-entering
        try { await RNBluetoothClassic.cancelAccept(); } catch {}

        console.log('[BluetoothService] Calling accept()...');

        // Accept with timeout — if no connection within 15s, cancel and retry
        // This prevents accept() from getting stuck forever
        let timeoutId: ReturnType<typeof setTimeout>;
        const dev = await Promise.race([
          RNBluetoothClassic.accept({} as any),
          new Promise<null>(resolve => {
            timeoutId = setTimeout(() => resolve(null), 15000);
          }),
        ]);
        clearTimeout(timeoutId!);

        if (!dev) {
          // Timed out — cancel accept and loop back
          try { await RNBluetoothClassic.cancelAccept(); } catch {}
          continue;
        }

        console.log('[BluetoothService] accept() returned:', dev.name || dev.address);
        if (this.running) {
          this.setupDevice(dev);
          // Wait until disconnected, then loop back to accept
          // Also timeout after 60s of no disconnect signal as a safety net
          await new Promise<void>(resolve => {
            let resolved = false;
            const done = () => { if (!resolved) { resolved = true; resolve(); } };
            const unsub = this.onStatusChange(s => {
              if (s === 'disconnected') {
                unsub();
                done();
              }
            });
            // Safety: if disconnect detection fails, force re-enter after 60s
            const safetyTimer = setInterval(async () => {
              if (!this.device) { clearInterval(safetyTimer); done(); return; }
              try {
                const connected = await this.device.isConnected();
                if (!connected) {
                  clearInterval(safetyTimer);
                  this.cleanup();
                  this.emitStatus('disconnected');
                }
              } catch {
                clearInterval(safetyTimer);
                this.cleanup();
                this.emitStatus('disconnected');
              }
            }, 5000);
          });
          console.log('[BluetoothService] Device disconnected, re-entering accept loop');
        }
      } catch (err) {
        // accept failed — wait a moment and retry
        console.log('[BluetoothService] accept() error:', err);
        try { await RNBluetoothClassic.cancelAccept(); } catch {}
        if (this.running) {
          await new Promise<void>(r => setTimeout(r, 1000));
        }
      }
    }
  }

  stop() {
    this.running = false;
    try { ForegroundService?.stop(); } catch {}
    try {
      RNBluetoothClassic.cancelAccept();
    } catch {}
    if (this.device) {
      try { this.device.disconnect(); } catch {}
      this.cleanup();
      this.emitStatus('disconnected');
    }
  }

  // ── Device setup ────────────────────────────────────────────────────────────

  private setupDevice(dev: any) {
    this.device = dev;
    this.buffer = '';

    console.log('[BluetoothService] Device methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(dev)));
    console.log('[BluetoothService] Device keys:', Object.keys(dev));

    // Try different API names for data subscription
    if (typeof dev.onDataReceived === 'function') {
      this.dataSubscription = dev.onDataReceived((event: any) => {
        this.handleData(event.data as string);
      });
    } else {
      console.log('[BluetoothService] No onDataReceived, trying read polling');
      this.startReadPolling(dev);
    }

    // Try different API names for disconnect subscription
    if (typeof dev.onDisconnected === 'function') {
      this.disconnectSubscription = dev.onDisconnected(() => {
        this.cleanup();
        this.emitStatus('disconnected');
      });
    } else {
      console.log('[BluetoothService] No onDisconnected, using connection polling');
      this.startDisconnectPolling(dev);
    }

    this.emitStatus('connected');
  }

  private startReadPolling(dev: any) {
    const poll = setInterval(async () => {
      if (!this.device) {
        clearInterval(poll);
        return;
      }
      try {
        const available = await dev.available();
        if (available > 0) {
          const data = await dev.read();
          if (data) {
            this.handleData(data);
          }
        }
      } catch {
        // Device probably disconnected
        clearInterval(poll);
        this.cleanup();
        this.emitStatus('disconnected');
      }
    }, 200);
    this.dataSubscription = { remove: () => clearInterval(poll) };
  }

  private startDisconnectPolling(dev: any) {
    let failCount = 0;
    const poll = setInterval(async () => {
      if (!this.device) {
        clearInterval(poll);
        return;
      }
      try {
        const connected = await dev.isConnected();
        if (!connected) {
          console.log('[BluetoothService] isConnected() returned false');
          clearInterval(poll);
          this.cleanup();
          this.emitStatus('disconnected');
        } else {
          failCount = 0;
        }
      } catch {
        failCount++;
        console.log('[BluetoothService] isConnected() threw, failCount:', failCount);
        if (failCount >= 2) {
          clearInterval(poll);
          this.cleanup();
          this.emitStatus('disconnected');
        }
      }
    }, 2000);
    this.disconnectSubscription = { remove: () => clearInterval(poll) };
  }

  private cleanup() {
    this.dataSubscription?.remove();
    this.disconnectSubscription?.remove();
    this.dataSubscription = null;
    this.disconnectSubscription = null;
    this.device = null;
    this.buffer = '';
  }

  // ── Data handling ─────────────────────────────────────────────────────────────

  private handleData(chunk: string) {
    this.buffer += chunk;
    const {lines, remaining} = extractLines(this.buffer);
    this.buffer = remaining;

    for (const line of lines) {
      const parsed = parseBluetoothLine(line);
      if (parsed && 'cmd' in parsed) {
        if (parsed.cmd === 'decrypt' || parsed.cmd === 'introduction' || parsed.cmd === 'ping') {
          this.emitCommand(parsed as BluetoothCommand);
        }
      }
    }
  }

  // ── Send response ───────────────────────────────────────────────────────────

  async sendResponse(response: BluetoothResponse): Promise<boolean> {
    if (!this.device) return false;
    try {
      await this.device.write(serializeForBluetooth(response));
      return true;
    } catch {
      return false;
    }
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  isConnected(): boolean {
    return this.device !== null;
  }

  isRunning(): boolean {
    return this.running;
  }

  getDeviceName(): string | null {
    return this.device?.name ?? null;
  }
}

export default new BluetoothService();
