import Clipboard from '@react-native-clipboard/clipboard';
import {NativeModules, NativeEventEmitter, AppState, AppStateStatus} from 'react-native';
import {serializeForTransport} from '../../utils/nohack';
import RelayUsbService from './RelayUsbService';
import RelayTelegramService from './RelayTelegramService';
import {markForwarded, wasForwarded} from './MessageDedup';
import type {TransportResponse} from '../../types';

const {ClipboardWatcher, ForegroundService, AccessibilityBridge} = NativeModules;

type Listener = (msg: string) => void;

class RelayClipboardService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastClipboard = '';
  private recentOutgoingIds = new Set<string>();
  private logListeners: Listener[] = [];
  private usbUnsub: (() => void) | null = null;
  private nativeUnsub: (() => void) | null = null;
  private serviceUnsub: (() => void) | null = null;
  private accessibilityUnsub: (() => void) | null = null;
  private appStateUnsub: (() => void) | null = null;
  private running = false;

  onLog(cb: Listener) {
    this.logListeners.push(cb);
    return () => { this.logListeners = this.logListeners.filter(l => l !== cb); };
  }

  private emitLog(msg: string) {
    this.logListeners.forEach(l => l(msg));
  }

  async isAccessibilityEnabled(): Promise<boolean> {
    if (!AccessibilityBridge) return false;
    try {
      return await AccessibilityBridge.isEnabled();
    } catch { return false; }
  }

  openAccessibilitySettings() {
    AccessibilityBridge?.openSettings();
  }

  async isOverlayPermissionGranted(): Promise<boolean> {
    if (!AccessibilityBridge) return false;
    try {
      return await AccessibilityBridge.canDrawOverlays();
    } catch { return false; }
  }

  requestOverlayPermission() {
    AccessibilityBridge?.requestOverlayPermission();
  }

  /** Restart foreground service to pick up newly granted overlay permission */
  restartServiceWithOverlay() {
    try {
      ForegroundService?.stop();
      setTimeout(() => {
        try { ForegroundService?.startWithClipboard(); } catch {}
      }, 500);
    } catch {}
  }

  start() {
    if (this.running) return;
    this.running = true;

    // Start foreground service with clipboard watching (keeps process alive)
    try { ForegroundService?.startWithClipboard(); } catch {}

    // Listen for messages from NoHack → copy to clipboard
    this.usbUnsub = RelayUsbService.onData((response: TransportResponse) => {
      if ((response.cmd === 'encrypted' || response.cmd === 'introduction') && response.payload) {
        this.copyToClipboard(response.payload);
      }
    });

    // === LAYER 1: Accessibility Service (HIGHEST PRIORITY — works in background) ===
    if (AccessibilityBridge) {
      try {
        AccessibilityBridge.startListening();
        const emitter = new NativeEventEmitter(AccessibilityBridge);
        const sub = emitter.addListener('onAccessibilityClipboardChange', (text: string) => {
          this.processClipboardContent(text);
        });
        this.accessibilityUnsub = () => {
          sub.remove();
          AccessibilityBridge.stopListening();
        };
      } catch {}
    }

    // === LAYER 2: Native clipboard listener (works if Android allows it) ===
    if (ClipboardWatcher) {
      try {
        const emitter = new NativeEventEmitter(ClipboardWatcher);
        const sub = emitter.addListener('onClipboardChange', (text: string) => {
          this.processClipboardContent(text);
        });
        ClipboardWatcher.startWatching();
        this.nativeUnsub = () => {
          sub.remove();
          ClipboardWatcher.stopWatching();
        };
      } catch {}
    }

    // === LAYER 3: Foreground service clipboard listener ===
    if (ForegroundService) {
      try {
        const serviceEmitter = new NativeEventEmitter(ForegroundService);
        const sub = serviceEmitter.addListener('onServiceClipboardChange', (text: string) => {
          this.processClipboardContent(text);
        });
        this.serviceUnsub = () => sub.remove();
      } catch {}
    }

    // === LAYER 4: AppState — check clipboard when app comes to foreground ===
    const appStateHandler = (state: AppStateStatus) => {
      if (state === 'active') {
        setTimeout(() => this.checkClipboard(), 300);
      }
    };
    const subscription = AppState.addEventListener('change', appStateHandler);
    this.appStateUnsub = () => subscription.remove();

    // === LAYER 5: JS polling (works in foreground) ===
    this.startPolling();

    this.emitLog('Clipboard watcher active');
  }

  private startPolling() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.checkClipboard(), 2000);
  }

  stop() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.accessibilityUnsub?.();
    this.accessibilityUnsub = null;
    this.nativeUnsub?.();
    this.nativeUnsub = null;
    this.serviceUnsub?.();
    this.serviceUnsub = null;
    this.appStateUnsub?.();
    this.appStateUnsub = null;
    this.usbUnsub?.();
    this.usbUnsub = null;
    try { ForegroundService?.stop(); } catch {}
  }

  private processClipboardContent(clip: string) {
    if (!clip || clip === this.lastClipboard) return;

    const trimmed = clip.trim();
    if (!trimmed.startsWith('{')) {
      this.lastClipboard = clip;
      return;
    }

    let data: any;
    try { data = JSON.parse(trimmed); } catch {
      this.lastClipboard = clip;
      return;
    }

    // Unwrap relay protocol wrapper
    if (data.cmd && data.payload && !data.nohack) {
      try { data = JSON.parse(data.payload); } catch {
        this.lastClipboard = clip;
        return;
      }
    }

    // Support both v2 and v3 nohack format
    const isV3 = data.nohack === '3' && data.id && data.tag;
    const isV2 = data.version === '2' && data.type && data.senderPublicKey;
    if (!isV3 && !isV2) {
      this.lastClipboard = clip;
      return;
    }

    // Skip our own outgoing messages
    const msgId = data.id;
    if (msgId && this.recentOutgoingIds.has(msgId)) {
      this.lastClipboard = clip;
      return;
    }

    // Dedup: skip if already forwarded via Telegram
    if (msgId && wasForwarded(msgId)) {
      this.lastClipboard = clip;
      return;
    }
    if (msgId) markForwarded(msgId);

    // Pass relayTelegramId through to NoHack — NoHack stores contact data

    // Forward to NoHack over USB
    const cmdType = data.type === 'introduction' ? 'introduction' : 'decrypt';
    const tag = data.tag || 'UNK';
    this.emitLog(`Clipboard detected: ${tag} (${cmdType})`);

    if (!RelayUsbService.isConnected()) {
      this.emitLog(`Cannot forward ${tag} — not connected to NoHack`);
      return;
    }

    const usbCmd = {cmd: cmdType, payload: JSON.stringify(data)};
    RelayUsbService.send(serializeForTransport(usbCmd)).then(sent => {
      if (sent) {
        this.lastClipboard = clip;
        this.emitLog(`Clipboard → NoHack: ${tag} (${cmdType})`);
        Clipboard.setString(' ');
      } else {
        this.emitLog(`Failed to send ${tag} to NoHack`);
      }
    });
  }

  private async checkClipboard() {
    try {
      const clip = await Clipboard.getString();
      this.processClipboardContent(clip);
    } catch {}
  }

  private copyToClipboard(payload: string) {
    try {
      const data = JSON.parse(payload);
      if (data.id) {
        this.recentOutgoingIds.add(data.id);
        setTimeout(() => this.recentOutgoingIds.delete(data.id), 30000);
      }
    } catch {}

    // Enrich outgoing messages with our Telegram username before clipboard
    const enriched = RelayTelegramService.enrichOutgoing(payload);

    Clipboard.setString(enriched);
    this.lastClipboard = enriched;
    try {
      const data = JSON.parse(payload);
      const tag = data.tag || '';
      this.emitLog(`NoHack → Clipboard: ${tag} (ready to paste)`);
    } catch {
      this.emitLog('NoHack → Clipboard (ready to paste)');
    }
  }
}

export default new RelayClipboardService();
