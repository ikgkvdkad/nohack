const fs = require('fs');
const path = require('path');
const { INBOX, OUTBOX, SENT } = require('./config');
const { keyToName } = require('./deviceName');
const telegramService = require('./telegramService');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Check if content is valid NoHack JSON
function isNoHackContent(content) {
  try {
    const data = JSON.parse(content.trim());
    // Support both v2 (.nohack file format) and v3 (transport protocol)
    if (data.nohack === '3' && data.id && data.tag) return true;
    if (data.version === '2' && data.type && data.senderPublicKey) return true;
    return false;
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

      // Send via Telegram
      telegramService.sendNoHack(response.payload);

      // Save to outbox for record
      fs.writeFileSync(path.join(OUTBOX, filename), response.payload, 'utf8');

      relay.emit('log', `${tag || 'Reply'} sent via Telegram`);
      relay.emit('activity', { type: 'received', name: filename, tag, time: new Date().toISOString() });
      break;
    }
    case 'introduction': {
      if (!response.payload) break;
      const tag = extractTag(response.payload);
      const filename = tag ? `${tag}-intro.txt` : `intro-${timestamp()}.txt`;

      let senderName = 'Unknown';
      try {
        const d = JSON.parse(response.payload);
        if (d.senderPublicKey) senderName = keyToName(d.senderPublicKey);
      } catch {}

      // Send via Telegram
      telegramService.sendNoHack(response.payload);

      // Save to outbox for record
      fs.writeFileSync(path.join(OUTBOX, filename), response.payload, 'utf8');

      relay.emit('log', `${senderName} contact card (${tag}) sent via Telegram`);
      relay.emit('activity', { type: 'received', name: filename, tag, time: new Date().toISOString() });
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
};
