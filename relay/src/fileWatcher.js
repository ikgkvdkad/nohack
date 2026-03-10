const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { INBOX, OUTBOX, SENT } = require('./config');
const { markAsOutgoing } = require('./clipboard');
const { keyToName } = require('./deviceName');
const telegramService = require('./telegramService');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Check if content is valid NoHack JSON
function isNoHackContent(content) {
  try {
    const data = JSON.parse(content.trim());
    // Support both v2 (.nohack file format) and v3 (clipboard protocol)
    if (data.nohack === '3' && data.id && data.tag) return true;
    if (data.version === '2' && data.type && data.senderPublicKey) return true;
    return false;
  } catch {
    return false;
  }
}

// Copy text to system clipboard
function copyTextToClipboard(text) {
  try {
    if (process.platform === 'win32') {
      const proc = spawn('clip');
      proc.stdin.write(text, 'utf8');
      proc.stdin.end();
    } else if (process.platform === 'darwin') {
      const proc = spawn('pbcopy');
      proc.stdin.write(text, 'utf8');
      proc.stdin.end();
    } else {
      const proc = spawn('xclip', ['-selection', 'clipboard']);
      proc.stdin.write(text, 'utf8');
      proc.stdin.end();
    }
  } catch {}
}

// Re-copy an outbox file's content to clipboard
function copyOutboxFile(filename) {
  try {
    const filePath = path.join(OUTBOX, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    copyTextToClipboard(content);
    return true;
  } catch {
    return false;
  }
}

// Send all pending files in inbox to the NoHack via relay
function sendPendingFiles(relay) {
  if (!relay.isConnected()) return;

  let files;
  try {
    files = fs.readdirSync(INBOX);
  } catch { return; }

  for (const file of files) {
    const filePath = path.join(INBOX, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (!isNoHackContent(content)) continue;

      const command = JSON.stringify({ cmd: 'decrypt', payload: content }) + '\n';
      relay.send(command).then(() => {
        relay.emit('log', `Sent: ${file}`);
        relay.emit('activity', { type: 'sent', name: file, time: new Date().toISOString() });
        try { fs.renameSync(filePath, path.join(SENT, file)); } catch {}
      }).catch(err => {
        relay.emit('log', `Failed to send ${file}: ${err.message}`);
      });
    } catch (e) {
      relay.emit('log', `Skipping ${file}: invalid - ${e.message}`);
    }
  }
}

// Extract the 3-letter tag from a JSON payload
function extractTag(payload) {
  try {
    const data = JSON.parse(payload);
    return data.tag || null;
  } catch {
    return null;
  }
}

// Handle responses from the NoHack device
function handleResponse(response, relay) {
  switch (response.cmd) {
    case 'encrypted': {
      if (!response.payload) break;
      const tag = extractTag(response.payload);
      const filename = tag ? `${tag}.txt` : `reply-${timestamp()}.txt`;

      // Mark as outgoing so clipboard watcher won't pick it back up
      try { const d = JSON.parse(response.payload); if (d.id) markAsOutgoing(d.id); } catch {}

      // Enrich with our Telegram username so receiver can route back
      const enrichedEncrypted = telegramService.enrichOutgoing(response.payload);

      // Send via Telegram (async, don't block clipboard)
      telegramService.sendNoHack(response.payload);

      // Save to hidden outbox only
      fs.writeFileSync(path.join(OUTBOX, filename), enrichedEncrypted, 'utf8');

      // Copy text to clipboard — user just Ctrl+V's it
      copyTextToClipboard(enrichedEncrypted);

      relay.emit('log', `${tag || 'Reply'} copied — Ctrl+V to paste`);
      relay.emit('activity', { type: 'received', name: filename, tag, time: new Date().toISOString(), copied: true });
      break;
    }
    case 'introduction': {
      if (!response.payload) break;
      const tag = extractTag(response.payload);
      const filename = tag ? `${tag}-intro.txt` : `intro-${timestamp()}.txt`;

      // Enrich with Telegram username so recipient can route messages back
      const enrichedPayload = telegramService.enrichOutgoing(response.payload);

      // Extract sender name from public key
      let senderName = 'Unknown';
      try {
        const d = JSON.parse(enrichedPayload);
        if (d.id) markAsOutgoing(d.id);
        if (d.senderPublicKey) senderName = keyToName(d.senderPublicKey);
      } catch {}

      fs.writeFileSync(path.join(OUTBOX, filename), enrichedPayload, 'utf8');
      copyTextToClipboard(enrichedPayload);

      relay.emit('log', `${senderName} contact card (${tag}) copied — Ctrl+V to paste`);
      relay.emit('activity', { type: 'received', name: filename, tag, time: new Date().toISOString(), copied: true });
      break;
    }
    case 'ack':
      if (response.deviceName) {
        relay.emit('deviceName', response.deviceName);
      }
      break;
    default:
      relay.emit('log', `Unknown response: ${response.cmd}`);
  }
}

// Receive a file from file association (double-click)
function receiveFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!isNoHackContent(content)) return null;
    const name = path.basename(filePath);
    const dest = path.join(INBOX, name);
    fs.writeFileSync(dest, content, 'utf8');
    return name;
  } catch {
    return null;
  }
}

// Start watchers
function startFileWatching(relay) {
  // Watch inbox for new files
  try {
    fs.watch(INBOX, (eventType, filename) => {
      if (!filename) return;
      setTimeout(() => sendPendingFiles(relay), 300);
    }).on('error', (err) => {
      relay.emit('log', `Inbox watcher error: ${err.message} — polling will continue`);
    });
  } catch (err) {
    relay.emit('log', `Could not watch inbox: ${err.message} — using polling only`);
  }

  // Listen for NoHack responses
  relay.on('data', (response) => handleResponse(response, relay));

  // Send pending files when connection comes up
  relay.on('connected', () => {
    setTimeout(() => sendPendingFiles(relay), 500);
  });

  // Poll every 5 seconds as backup
  setInterval(() => {
    sendPendingFiles(relay);
  }, 5000);
}

module.exports = {
  startFileWatching,
  sendPendingFiles,
  receiveFile,
  copyOutboxFile,
};
