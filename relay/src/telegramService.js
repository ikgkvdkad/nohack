const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const {
  loadTelegramCredentials,
  saveTelegramCredentials,
} = require('./telegramConfig');
const { markForwarded, wasForwarded } = require('./clipboard');
const { keyToName } = require('./deviceName');

// ── Telegram API credentials ────────────────────────────────────────────────
// Register your own at https://my.telegram.org → API development tools
const API_ID = 37345390;
const API_HASH = '7952bfe27a66884b8a99d530c198b627';

let client = null;

// Name cache for Telegram users
const nameCache = new Map();
let sessionString = '';
let username = '';
let phoneNumber = '';
let status = 'offline';
let running = false;
const seenIds = new Set();
let savedMsgPollTimer = null;
let lastSavedMsgId = 0;

// Pending auth state
let pendingPhoneCodeResolve = null;
let pendingPasswordResolve = null;
let codePollingTimer = null;

// Event listeners
let relay = null;

function emitLog(msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] ${msg}`);
  if (relay) relay.emit('log', msg);
  if (module.exports.onLog) module.exports.onLog(msg);
}

function setStatus(s) {
  status = s;
}

function getStatus() { return status; }
function getUserId() { return username ? `@${username}` : ''; }
function isConfigured() { return !!sessionString; }
function getContacts() { return []; }
function isWaitingForCode() { return !!pendingPhoneCodeResolve; }
function isWaitingForPassword() { return !!pendingPasswordResolve; }

// ── Lifecycle ───────────────────────────────────────────────────────────────

async function init(relayInstance) {
  relay = relayInstance;
  const creds = loadTelegramCredentials();
  if (!creds) {
    emitLog('Telegram: not configured');
    return;
  }

  sessionString = creds.sessionString;
  username = creds.username;
  phoneNumber = creds.phoneNumber;
  emitLog(`Telegram: @${username}`);
  await connectClient();
}

function stop() {
  running = false;
  stopCodePolling();
  if (savedMsgPollTimer) {
    clearInterval(savedMsgPollTimer);
    savedMsgPollTimer = null;
  }
  if (client) {
    try { client.disconnect(); } catch {}
    client = null;
  }
  setStatus('offline');
}

// ── Client connection ───────────────────────────────────────────────────────

async function connectClient() {
  setStatus('connecting');
  running = true;

  try {
    const session = new StringSession(sessionString);
    client = new TelegramClient(session, API_ID, API_HASH, {
      connectionRetries: 5,
    });

    await client.connect();

    client.addEventHandler(
      (event) => handleIncomingMessage(event),
      new NewMessage({}),
    );

    setStatus('online');
    emitLog('Telegram: online');
    startSavedMessagesPoll();
  } catch (err) {
    emitLog(`Telegram: connection failed — ${err.message}`);
    setStatus('offline');

    if (running) {
      setTimeout(() => connectClient(), 10000);
    }
  }
}

// ── Authentication ──────────────────────────────────────────────────────────

async function requestCode(phone) {
  phoneNumber = phone;

  const session = new StringSession('');
  client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.connect();

  const authPromise = client.start({
    phoneNumber: () => phone,
    phoneCode: () => new Promise((resolve, reject) => {
      pendingPhoneCodeResolve = resolve;
      startCodePolling();
    }),
    password: () => new Promise((resolve, reject) => {
      pendingPasswordResolve = resolve;
    }),
    onError: (err) => {
      emitLog(`Telegram auth error: ${err.message}`);
      throw err;
    },
  });

  authPromise.then(async () => {
    const savedSession = client.session.save();
    const me = await client.getMe();
    username = me.username || me.id?.toString() || '';
    sessionString = savedSession;

    saveTelegramCredentials({
      sessionString: savedSession,
      phoneNumber,
      username,
    });

    client.addEventHandler(
      (event) => handleIncomingMessage(event),
      new NewMessage({}),
    );

    running = true;
    setStatus('online');
    emitLog(`Telegram: logged in as @${username}`);
    startSavedMessagesPoll();
  }).catch((err) => {
    emitLog(`Telegram: login failed — ${err.message}`);
  });
}

function stopCodePolling() {
  if (codePollingTimer) {
    clearInterval(codePollingTimer);
    codePollingTimer = null;
  }
}

function startCodePolling() {
  stopCodePolling();
  const startTime = Date.now();
  codePollingTimer = setInterval(async () => {
    if (Date.now() - startTime > 120000) { stopCodePolling(); return; }
    if (!pendingPhoneCodeResolve || !client) return;
    try {
      const messages = await client.getMessages(777000, { limit: 3 });
      for (const msg of messages) {
        if (!msg.text) continue;
        if (msg.date && (Date.now() / 1000 - msg.date) > 120) continue;
        const match = msg.text.match(/(\d{5})/);
        if (match && pendingPhoneCodeResolve) {
          const code = match[1];
          emitLog(`Auto-read verification code: ${code}`);
          if (module.exports.onAutoCode) module.exports.onAutoCode(code);
          pendingPhoneCodeResolve(code);
          pendingPhoneCodeResolve = null;
          stopCodePolling();
          return;
        }
      }
    } catch (err) {
      console.log(`[AutoCode] poll error: ${err.message}`);
    }
  }, 2000);
}

function submitCode(code) {
  if (pendingPhoneCodeResolve) {
    stopCodePolling();
    pendingPhoneCodeResolve(code);
    pendingPhoneCodeResolve = null;
    return true;
  }
  return false;
}

function submitPassword(password) {
  if (pendingPasswordResolve) {
    pendingPasswordResolve(password);
    pendingPasswordResolve = null;
    return true;
  }
  return false;
}

// ── Saved Messages polling ──────────────────────────────────────────────────
// NewMessage event doesn't fire for messages sent by another client on
// the same account. Poll Saved Messages to catch them.

function startSavedMessagesPoll() {
  if (savedMsgPollTimer) clearInterval(savedMsgPollTimer);
  savedMsgPollTimer = setInterval(() => pollSavedMessages(), 5000);
  setTimeout(() => pollSavedMessages(), 2000);
}

async function pollSavedMessages() {
  if (!client || status !== 'online') return;

  try {
    const messages = await client.getMessages('me', { limit: 5 });

    for (const message of messages) {
      if (message.id <= lastSavedMsgId) continue;

      let text = '';

      if (message.text) {
        text = message.text.trim();
      }

      if (!text && message.document) {
        try {
          const doc = message.document;
          const fileName = doc.attributes?.find(a => a.fileName)?.fileName || '';
          if (fileName.endsWith('.nohack')) {
            const buffer = await client.downloadMedia(message);
            if (buffer) {
              text = Buffer.from(buffer).toString('utf-8').trim();
            }
          }
        } catch {}
      }

      lastSavedMsgId = message.id;

      if (!text || !text.startsWith('{')) continue;

      let data;
      try { data = JSON.parse(text); } catch { continue; }

      if (data.nohack !== '3' || !data.id || !data.tag) continue;

      if (seenIds.has(data.id)) continue;
      seenIds.add(data.id);
      setTimeout(() => seenIds.delete(data.id), 120000);

      if (wasForwarded(data.id)) continue;
      markForwarded(data.id);

      const cmdType = data.type === 'introduction' ? 'introduction' : 'decrypt';
      if (data.type !== 'ack') {
        const senderName = data.senderName || (data.senderPublicKey ? keyToName(data.senderPublicKey) : '?');
        emitLog(`${senderName} → Virtual NoHack: ${data.tag} (${cmdType})`);
      }

      if (module.exports.onIncoming) {
        module.exports.onIncoming(data);
      }
    }
  } catch {}
}

// ── Incoming messages ───────────────────────────────────────────────────────

async function handleIncomingMessage(event) {
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
      const fileName = doc.attributes?.find(a => a.fileName)?.fileName || '';
      if (fileName.endsWith('.nohack')) {
        const buffer = await client.downloadMedia(message);
        if (buffer) {
          text = Buffer.from(buffer).toString('utf-8').trim();
        }
      }
    } catch {}
  }

  if (!text || !text.startsWith('{')) return;

  let data;
  try { data = JSON.parse(text); } catch { return; }

  if (data.nohack !== '3' || !data.id || !data.tag) return;

  // Dedup
  if (seenIds.has(data.id)) return;
  seenIds.add(data.id);
  setTimeout(() => seenIds.delete(data.id), 120000);

  if (wasForwarded(data.id)) return;
  markForwarded(data.id);

  // Pass relayTelegramId through to NoHack — NoHack stores contact data

  const cmdType = data.type === 'introduction' ? 'introduction' : 'decrypt';
  if (data.type !== 'ack') {
    const senderName = data.senderName || (data.senderPublicKey ? keyToName(data.senderPublicKey) : '?');
    emitLog(`${senderName} → NoHack: ${data.tag} (${cmdType})`);
  }

  // Forward to NoHack via Bluetooth relay
  if (relay && relay.isConnected()) {
    const cmd = JSON.stringify({ cmd: cmdType, payload: JSON.stringify(data) }) + '\n';
    relay.send(cmd).catch(err => {
      emitLog(`Failed to forward to NoHack: ${err.message}`);
    });
  }

  // Forward to virtual NoHack via WebSocket
  if (module.exports.onIncoming) {
    module.exports.onIncoming(data);
  }
}

// ── Name resolution ─────────────────────────────────────────────────────────

async function resolveName(telegramId) {
  if (!telegramId || telegramId === 'me') return 'Saved Messages';
  if (nameCache.has(telegramId)) return nameCache.get(telegramId);
  try {
    if (client && status === 'online') {
      const entity = await client.getEntity(telegramId);
      const name = entity.firstName
        ? `${entity.firstName}${entity.lastName ? ' ' + entity.lastName : ''}`
        : entity.username || telegramId;
      nameCache.set(telegramId, name);
      return name;
    }
  } catch {}
  return telegramId;
}

// ── Sending ─────────────────────────────────────────────────────────────────

async function sendNoHack(payload) {
  if (!client || status !== 'online') return;

  let data;
  try { data = JSON.parse(payload); } catch { return; }

  // Route by recipientTelegramId (provided by NoHack)
  // If missing, send to Saved Messages ('me')
  let recipientTelegramId = data.recipientTelegramId;
  if (!recipientTelegramId) {
    recipientTelegramId = 'me';
    emitLog(`${data.tag || '?'}: no recipientTelegramId — sending to Saved Messages`);
  }

  // Strip routing metadata, enrich with our Telegram username
  delete data.recipientTelegramId;
  if (username) {
    data.relayTelegramId = username;
  }
  const enriched = JSON.stringify(data);

  // Mark as sent so incoming handler skips our own message (echo prevention)
  if (data.id) {
    seenIds.add(data.id);
    setTimeout(() => seenIds.delete(data.id), 120000);
  }

  try {
    // Always send as .nohack file — cleaner than raw JSON text in Telegram
    const { CustomFile } = require('telegram/client/uploads');
    const buf = Buffer.from(enriched, 'utf-8');
    // Use senderName or keyToName for introductions
    const fileName = data.type === 'introduction' && data.senderPublicKey
      ? `${data.senderName || keyToName(data.senderPublicKey)}.nohack`
      : `${data.tag || 'nohack'}.nohack`;
    const file = new CustomFile(fileName, buf.length, '', buf);
    await client.sendFile(recipientTelegramId, { file, caption: '' });
    const recipientName = await resolveName(recipientTelegramId);
    if (data.type !== 'ack') {
      emitLog(`NoHack → Telegram: ${data.tag || '?'} → ${recipientName}`);
    }
  } catch (err) {
    emitLog(`Telegram send failed: ${err.message}`);
  }
}

function enrichOutgoing(noHackJson) {
  if (!username) return noHackJson;
  try {
    const data = JSON.parse(noHackJson);
    if (data.nohack === '3') {
      data.relayTelegramId = username;
      return JSON.stringify(data);
    }
  } catch {}
  return noHackJson;
}

module.exports = {
  init,
  stop,
  getStatus,
  getUserId,
  isConfigured,
  getContacts,
  isWaitingForCode,
  isWaitingForPassword,
  requestCode,
  submitCode,
  submitPassword,
  sendNoHack,
  enrichOutgoing,
  onIncoming: null, // Set by server.js to forward to WebSocket clients
  onLog: null, // Set by server.js to broadcast logs
  onAutoCode: null, // Set by server.js to broadcast auto-detected verification code
};
