const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { INBOX } = require('./config');
// Dedup shared between clipboard and Telegram
const forwarded = new Set();
function markForwarded(id) { forwarded.add(id); setTimeout(() => forwarded.delete(id), 60000); }
function wasForwarded(id) { return forwarded.has(id); }

let lastClipboard = '';
let consecutiveErrors = 0;

// Track IDs of messages we recently copied to clipboard (outgoing)
// so we don't pick them up as incoming
const recentOutgoingIds = new Set();

function markAsOutgoing(id) {
  recentOutgoingIds.add(id);
  setTimeout(() => recentOutgoingIds.delete(id), 30000);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function checkClipboard(relay) {
  let clip;
  try {
    clip = execSync('powershell -NoProfile -Command "Get-Clipboard -Raw"', {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    }).trim();
    // Reset error counter on success
    if (consecutiveErrors > 0) {
      relay.emit('log', 'Clipboard watcher recovered');
      consecutiveErrors = 0;
    }
  } catch (err) {
    consecutiveErrors++;
    if (consecutiveErrors === 3) {
      relay.emit('log', `Clipboard read failing: ${err.message || 'timeout'}`);
    }
    // Don't spam logs — only log every 10th failure after first warning
    if (consecutiveErrors > 3 && consecutiveErrors % 10 === 0) {
      relay.emit('log', `Clipboard still failing (${consecutiveErrors} errors)`);
    }
    return;
  }

  // Skip if same as last check or empty
  if (!clip || clip === lastClipboard) return;
  lastClipboard = clip;

  // Must look like JSON
  if (!clip.startsWith('{')) return;

  let data;
  try { data = JSON.parse(clip); } catch (e) {
    relay.emit('log', `Clipboard: JSON-like but invalid — ${e.message}`);
    return;
  }

  // Unwrap relay protocol format: {"cmd":"...","payload":"..."}
  if (data.cmd && data.payload && !data.nohack) {
    try { data = JSON.parse(data.payload); } catch { return; }
  }

  // Must be a valid .nohack file (v2 or v3)
  const isV3 = data.nohack === '3' && data.id && data.tag;
  const isV2 = data.version === '2' && data.type && data.senderPublicKey;
  if (!isV3 && !isV2) return;

  // Skip messages we ourselves just copied to clipboard (outgoing)
  if (recentOutgoingIds.has(data.id)) return;

  // Dedup: skip if already forwarded via Telegram
  if (data.id && wasForwarded(data.id)) return;
  if (data.id) markForwarded(data.id);

  // Pass relayTelegramId through to NoHack — NoHack stores contact data

  // Save to inbox
  const tag = data.tag || 'UNK';
  const filename = `clipboard-${tag}-${timestamp()}.nohack`;
  const filePath = path.join(INBOX, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
  } catch (err) {
    relay.emit('log', `Failed to save ${filename}: ${err.message}`);
    return;
  }
  relay.emit('log', `Clipboard captured: ${tag}`);
  relay.emit('activity', { type: 'clipboard', name: filename, tag, time: new Date().toISOString() });

  // Clear clipboard so we don't pick it up again
  try {
    execSync("powershell -NoProfile -Command \"Set-Clipboard -Value ' '\"", {
      timeout: 3000,
      windowsHide: true,
    });
  } catch {}
}

function startClipboardWatcher(relay) {
  // Poll every 1.5s for faster response
  setInterval(() => checkClipboard(relay), 1500);
  relay.emit('log', 'Clipboard watcher active');
}

module.exports = { startClipboardWatcher, markAsOutgoing, markForwarded, wasForwarded };
