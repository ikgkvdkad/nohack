import {
  getTelegramCredentials,
  saveTelegramCredentials,
} from '../store/relayStore';
import {markForwarded, wasForwarded} from './MessageDedup';
import {keyToName} from '../../utils/deviceName';
import type {NoHackFile} from '../../types';

// GramJS imports — lazy-loaded to ensure Buffer polyfill is ready
let TelegramClient: any;
let StringSession: any;
let NewMessage: any;
let PromisedWebSockets: any;
let ConnectionTCPObfuscated: any;

function ensureGramJS() {
  if (!TelegramClient) {
    // Double-check Buffer polyfill before loading GramJS (it uses Buffer extensively)
    if (typeof global.Buffer === 'undefined') {
      const {Buffer: B} = require('buffer');
      global.Buffer = B;
    }
    // Hermes doesn't define Symbol.asyncIterator — GramJS needs it for getMessages
    if (typeof Symbol.asyncIterator === 'undefined') {
      (Symbol as any).asyncIterator = Symbol.for('Symbol.asyncIterator');
    }
    TelegramClient = require('telegram').TelegramClient;
    StringSession = require('telegram/sessions').StringSession;
    NewMessage = require('telegram/events').NewMessage;
    PromisedWebSockets = require('telegram/extensions').PromisedWebSockets;
    ConnectionTCPObfuscated =
      require('telegram/network/connection').ConnectionTCPObfuscated;
    console.log('[GramJS] loaded OK');
  }
}

// ── Telegram API credentials ───────────────────────────────────────────────
const API_ID = 37345390;
const API_HASH = '7952bfe27a66884b8a99d530c198b627';

type Listener<T> = (arg: T) => void;
type TelegramStatus = 'offline' | 'connecting' | 'online';

class RelayTelegramService {
  private client: any = null;
  private sessionString = '';
  private username = '';
  private phoneNumber = '';
  private seenIds = new Set<string>();
  private running = false;
  private savedMsgPollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSavedMsgId = 0; // track highest processed Telegram message ID in Saved Messages
  private nameCache = new Map<string, string>(); // telegramId → display name

  private dataListeners: Listener<NoHackFile>[] = [];
  private statusListeners: Listener<TelegramStatus>[] = [];
  private logListeners: Listener<string>[] = [];
  private status: TelegramStatus = 'offline';

  // Outbound queue: messages waiting to be sent when Telegram comes online
  private outboundQueue: string[] = []; // raw payload strings

  // Pending auth state (used during login flow)
  private pendingPhoneCodeResolve: ((code: string) => void) | null = null;
  private pendingPasswordResolve: ((pw: string) => void) | null = null;
  private authReject: ((err: Error) => void) | null = null;
  private codePollingTimer: ReturnType<typeof setInterval> | null = null;
  private autoCodeListeners: Listener<string>[] = [];

  // ── Event subscriptions ──────────────────────────────────────────────────

  onData(cb: Listener<NoHackFile>) {
    this.dataListeners.push(cb);
    return () => { this.dataListeners = this.dataListeners.filter(l => l !== cb); };
  }

  onStatusChange(cb: Listener<TelegramStatus>) {
    this.statusListeners.push(cb);
    return () => { this.statusListeners = this.statusListeners.filter(l => l !== cb); };
  }

  onLog(cb: Listener<string>) {
    this.logListeners.push(cb);
    return () => { this.logListeners = this.logListeners.filter(l => l !== cb); };
  }

  getStatus(): TelegramStatus { return this.status; }
  getUserId(): string { return this.username ? `@${this.username}` : ''; }
  isConfigured(): boolean { return !!this.sessionString; }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    const creds = await getTelegramCredentials();
    if (!creds) {
      this.emitLog('Telegram: not configured');
      return;
    }

    this.sessionString = creds.sessionString;
    this.username = creds.username;
    this.phoneNumber = creds.phoneNumber;

    this.emitLog(`Telegram: @${this.username}`);
    await this.connectClient();
  }

  stop() {
    this.running = false;
    this.stopCodePolling();
    if (this.savedMsgPollTimer) {
      clearInterval(this.savedMsgPollTimer);
      this.savedMsgPollTimer = null;
    }
    if (this.client) {
      try { this.client.disconnect(); } catch {}
      this.client = null;
    }
    this.setStatus('offline');
  }

  // ── Client connection ────────────────────────────────────────────────────

  private async connectClient(): Promise<void> {
    this.setStatus('connecting');
    this.running = true;
    ensureGramJS();

    try {
      const session = new StringSession(this.sessionString);
      this.client = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true,
        networkSocket: PromisedWebSockets,
        connection: ConnectionTCPObfuscated,
      });

      await this.client.connect();

      this.client.addEventHandler(
        (event: any) => this.handleIncomingMessage(event),
        new NewMessage({}),
      );

      this.setStatus('online');
      this.emitLog('Telegram: online');
      this.startSavedMessagesPoll();
    } catch (err: any) {
      this.emitLog(`Telegram: connection failed — ${err.message}`);
      this.setStatus('offline');

      if (this.running) {
        setTimeout(() => this.connectClient(), 10000);
      }
    }
  }

  // ── Authentication ─────────────────────────────────────────────────────

  async requestCode(phoneNumber: string): Promise<void> {
    this.phoneNumber = phoneNumber;
    ensureGramJS();

    const session = new StringSession('');
    this.client = new TelegramClient(session, API_ID, API_HASH, {
      connectionRetries: 5,
      useWSS: true,
      networkSocket: PromisedWebSockets,
      connection: ConnectionTCPObfuscated,
    });

    await this.client.connect();

    const authPromise = this.client.start({
      phoneNumber: () => phoneNumber,
      phoneCode: () => new Promise<string>((resolve, reject) => {
        this.pendingPhoneCodeResolve = resolve;
        this.authReject = reject;
        // Start polling for the verification code from Telegram service notifications
        this.startCodePolling();
      }),
      password: () => new Promise<string>((resolve, reject) => {
        this.pendingPasswordResolve = resolve;
        this.authReject = reject;
      }),
      onError: (err: Error) => {
        this.emitLog(`Telegram auth error: ${err.message}`);
        throw err;
      },
    });

    authPromise.then(async () => {
      const savedSession = this.client.session.save() as string;
      const me = await this.client.getMe();
      this.username = me.username || me.id?.toString() || '';
      this.sessionString = savedSession;

      await saveTelegramCredentials({
        sessionString: savedSession,
        phoneNumber: this.phoneNumber,
        username: this.username,
      });

      this.client.addEventHandler(
        (event: any) => this.handleIncomingMessage(event),
        new NewMessage({}),
      );

      this.running = true;
      this.setStatus('online');
      this.emitLog(`Telegram: logged in as @${this.username}`);
    }).catch((err: any) => {
      this.emitLog(`Telegram: login failed — ${err.message}`);
    });
  }

  submitCode(code: string): boolean {
    if (this.pendingPhoneCodeResolve) {
      this.stopCodePolling();
      this.pendingPhoneCodeResolve(code);
      this.pendingPhoneCodeResolve = null;
      return true;
    }
    return false;
  }

  submitPassword(password: string): boolean {
    if (this.pendingPasswordResolve) {
      this.pendingPasswordResolve(password);
      this.pendingPasswordResolve = null;
      return true;
    }
    return false;
  }

  isWaitingForCode(): boolean {
    return !!this.pendingPhoneCodeResolve;
  }

  isWaitingForPassword(): boolean {
    return !!this.pendingPasswordResolve;
  }

  onAutoCode(cb: Listener<string>) {
    this.autoCodeListeners.push(cb);
    return () => { this.autoCodeListeners = this.autoCodeListeners.filter(l => l !== cb); };
  }

  private stopCodePolling() {
    if (this.codePollingTimer) {
      clearInterval(this.codePollingTimer);
      this.codePollingTimer = null;
    }
  }

  private startCodePolling() {
    this.stopCodePolling();
    const startTime = Date.now();
    this.codePollingTimer = setInterval(async () => {
      // Stop after 2 minutes
      if (Date.now() - startTime > 120000) {
        this.stopCodePolling();
        return;
      }
      if (!this.pendingPhoneCodeResolve || !this.client) return;

      try {
        // Telegram service notifications come from user ID 777000
        const messages = await this.client.getMessages(777000, {limit: 3});
        for (const msg of messages) {
          if (!msg.text) continue;
          // Messages older than 2 minutes are not relevant
          if (msg.date && (Date.now() / 1000 - msg.date) > 120) continue;
          // Extract 5-digit code from the message
          const match = msg.text.match(/(\d{5})/);
          if (match && this.pendingPhoneCodeResolve) {
            const code = match[1];
            this.emitLog(`Auto-read verification code: ${code}`);
            this.autoCodeListeners.forEach(l => l(code));
            this.pendingPhoneCodeResolve(code);
            this.pendingPhoneCodeResolve = null;
            this.stopCodePolling();
            return;
          }
        }
      } catch (err: any) {
        console.log(`[AutoCode] poll error: ${err.message}`);
      }
    }, 2000);
  }

  // ── Incoming messages ────────────────────────────────────────────────────
  // Pass through to NoHack — do NOT strip relayTelegramId, NoHack needs it

  private async handleIncomingMessage(event: any) {
    const message = event.message;
    if (!message) return;

    let text = '';

    // Check for text message first
    if (message.text) {
      text = message.text.trim();
    }

    // Check for .nohack file attachment (used for large payloads like photos)
    if (!text && message.document) {
      try {
        const doc = message.document;
        const fileName = doc.attributes?.find((a: any) => a.fileName)?.fileName || '';
        if (fileName.endsWith('.nohack')) {
          const buffer = await this.client.downloadMedia(message);
          if (buffer) {
            text = Buffer.from(buffer).toString('utf-8').trim();
          }
        }
      } catch {}
    }

    if (!text || !text.startsWith('{')) return;

    let data: any;
    try { data = JSON.parse(text); } catch { return; }

    if (data.nohack !== '3' || !data.id || !data.tag) return;

    // Dedup
    if (this.seenIds.has(data.id)) return;
    this.seenIds.add(data.id);
    setTimeout(() => this.seenIds.delete(data.id), 120000);

    if (wasForwarded(data.id)) return;
    markForwarded(data.id);

    const cmdType = data.type === 'introduction' ? 'introduction' : 'decrypt';
    const senderName = await this.resolveName(message.senderId?.toString());
    this.emitLog(`${senderName} → NoHack: ${data.tag} (${cmdType})`);

    this.dataListeners.forEach(l => l(data as NoHackFile));
  }

  // ── Saved Messages polling ─────────────────────────────────────────────
  // NewMessage event doesn't fire for messages sent by another client on
  // the same account (they're "outgoing"). Poll Saved Messages to catch them.

  private startSavedMessagesPoll() {
    if (this.savedMsgPollTimer) clearInterval(this.savedMsgPollTimer);
    this.savedMsgPollTimer = setInterval(() => this.pollSavedMessages(), 5000);
    // Initial poll after short delay
    setTimeout(() => this.pollSavedMessages(), 2000);
  }

  private async pollSavedMessages() {
    if (!this.client || this.status !== 'online') return;

    try {
      const messages = await this.client.getMessages('me', {
        limit: 5,
      });

      for (const message of messages) {
        // Skip messages we've already seen (by Telegram message ID)
        if (message.id <= this.lastSavedMsgId) continue;

        let text = '';

        if (message.text) {
          text = message.text.trim();
        }

        if (!text && message.document) {
          try {
            const doc = message.document;
            const fileName = doc.attributes?.find((a: any) => a.fileName)?.fileName || '';
            if (fileName.endsWith('.nohack')) {
              console.log(`[SavedPoll] downloading ${fileName} (msg ${message.id})`);
              const buffer = await this.client.downloadMedia(message);
              if (buffer) {
                text = Buffer.from(buffer).toString('utf-8').trim();
              }
            } else {
              console.log(`[SavedPoll] msg ${message.id} has doc but not .nohack: ${fileName}`);
            }
          } catch (dlErr: any) {
            console.log(`[SavedPoll] download error: ${dlErr.message}`);
          }
        }

        // Update high-water mark
        this.lastSavedMsgId = message.id;

        if (!text || !text.startsWith('{')) {
          if (text) {
            console.log(`[SavedPoll] msg ${message.id} skipped — not JSON`);
          }
          continue;
        }

        let data: any;
        try { data = JSON.parse(text); } catch { continue; }

        if (data.nohack !== '3' || !data.id || !data.tag) {
          console.log(`[SavedPoll] msg ${message.id} skipped — not nohack v3`);
          continue;
        }

        // Dedup by .nohack message ID
        if (this.seenIds.has(data.id)) {
          console.log(`[SavedPoll] ${data.tag} skipped — already in seenIds`);
          continue;
        }
        this.seenIds.add(data.id);
        setTimeout(() => this.seenIds.delete(data.id), 120000);

        if (wasForwarded(data.id)) {
          console.log(`[SavedPoll] ${data.tag} skipped — wasForwarded`);
          continue;
        }
        markForwarded(data.id);

        const cmdType = data.type === 'introduction' ? 'introduction' : 'decrypt';
        console.log(`[SavedPoll] ${data.tag} → forwarding (${cmdType})`);
        this.emitLog(`Saved Messages → NoHack: ${data.tag} (${cmdType})`);

        this.dataListeners.forEach(l => l(data as NoHackFile));
      }
    } catch (err: any) {
      console.log(`[SavedPoll] error: ${err.message}`);
    }
  }

  // ── Sending ──────────────────────────────────────────────────────────────
  // NoHack provides recipientTelegramId — Relay just reads it and sends

  async sendNoHack(payload: string): Promise<void> {
    if (!this.client || this.status !== 'online') {
      this.outboundQueue.push(payload);
      this.emitLog(`Telegram offline — queued (${this.outboundQueue.length} pending)`);
      return;
    }

    let data: any;
    try { data = JSON.parse(payload); } catch { return; }

    // Route by recipientTelegramId (provided by NoHack)
    // If missing, send to Saved Messages ('me') for testing
    let recipientTelegramId = data.recipientTelegramId;
    if (!recipientTelegramId) {
      recipientTelegramId = 'me';
      this.emitLog('Telegram: no recipientTelegramId — sending to Saved Messages');
    }

    // Strip routing metadata before sending, enrich with our Telegram username
    delete data.recipientTelegramId;
    if (this.username) {
      data.relayTelegramId = this.username;
    }
    const enriched = JSON.stringify(data);

    // Mark as sent so incoming handler skips our own message (echo prevention)
    if (data.id) {
      this.seenIds.add(data.id);
      setTimeout(() => this.seenIds.delete(data.id), 120000);
    }

    try {
      // Always send as .nohack file — cleaner than raw JSON text in Telegram
      const {CustomFile} = require('telegram/client/uploads');
      const buffer = Buffer.from(enriched, 'utf-8');
      // Use senderName (custom name) for introductions, fall back to keyToName
      const fileName = data.type === 'introduction' && data.senderPublicKey
        ? `${data.senderName || keyToName(data.senderPublicKey)}.nohack`
        : `${data.tag || 'nohack'}.nohack`;
      const file = new CustomFile(fileName, buffer.length, '', buffer);
      await this.client.sendFile(recipientTelegramId, {file, caption: ''});
      const recipientName = await this.resolveName(recipientTelegramId);
      this.emitLog(`NoHack → Telegram: ${data.tag || '?'} → ${recipientName}`);
    } catch (err: any) {
      this.emitLog(`Telegram send failed: ${err.message}`);
    }
  }

  /**
   * Enrich any outgoing .nohack message with our Telegram username.
   * Used for clipboard path (non-Telegram).
   */
  enrichOutgoing(noHackJson: string): string {
    if (!this.username) return noHackJson;
    try {
      const data = JSON.parse(noHackJson);
      if (data.nohack === '3') {
        data.relayTelegramId = this.username;
        return JSON.stringify(data);
      }
    } catch {}
    return noHackJson;
  }

  // ── Name resolution ────────────────────────────────────────────────────

  private async resolveName(telegramId: string | undefined): Promise<string> {
    if (!telegramId || telegramId === 'me') return 'Saved Messages';
    const cached = this.nameCache.get(telegramId);
    if (cached) return cached;

    if (!this.client || this.status !== 'online') return `@${telegramId}`;

    try {
      const entity = await this.client.getEntity(telegramId);
      const name = entity.username
        ? `@${entity.username}`
        : [entity.firstName, entity.lastName].filter(Boolean).join(' ') || `@${telegramId}`;
      this.nameCache.set(telegramId, name);
      return name;
    } catch {
      return `@${telegramId}`;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private setStatus(s: TelegramStatus) {
    this.status = s;
    this.statusListeners.forEach(l => l(s));
    if (s === 'online') {
      this.flushOutboundQueue();
    }
  }

  private async flushOutboundQueue(): Promise<void> {
    if (this.outboundQueue.length === 0) return;
    const queue = [...this.outboundQueue];
    this.outboundQueue = [];
    this.emitLog(`Flushing ${queue.length} queued message(s)...`);
    for (const payload of queue) {
      await this.sendNoHack(payload);
    }
  }

  private emitLog(msg: string) {
    console.log(`[RelayTelegram] ${msg}`);
    this.logListeners.forEach(l => l(msg));
  }
}

export default new RelayTelegramService();
