const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');

const config = require('./config');
const { getHtmlPage } = require('./ui');
const telegramService = require('./telegramService');

const PORT = 19847;

// ── Express + WebSocket ──────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.text({ type: '*/*', limit: '1mb' }));

app.get('/', (_req, res) => {
  res.type('html').send(getHtmlPage(PORT));
});

// ── Broadcast to all WebSocket clients ───────────────────────────────────────

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(data);
  });
}

function broadcastState() {
  broadcast({
    type: 'state',
    state: 'ready',
    telegramStatus: telegramService.getStatus(),
    telegramId: telegramService.getUserId(),
  });
}

// ── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] ${msg}`);
  broadcast({ type: 'log', message: msg, time });
}

// ── WebSocket commands from browser ──────────────────────────────────────────

wss.on('connection', async (ws) => {
  ws.send(JSON.stringify({
    type: 'state',
    state: 'ready',
    telegramStatus: telegramService.getStatus(),
    telegramId: telegramService.getUserId(),
  }));

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.cmd) {
        case 'telegram-code': {
          if (msg.phone) {
            try {
              await telegramService.requestCode(msg.phone);
              log('Telegram: verification code sent');
              ws.send(JSON.stringify({ type: 'telegram-step', step: 'code' }));
            } catch (err) {
              ws.send(JSON.stringify({ type: 'telegram-error', error: err.message }));
            }
          }
          break;
        }
        case 'telegram-verify': {
          if (msg.code) {
            const ok = telegramService.submitCode(msg.code);
            if (!ok) ws.send(JSON.stringify({ type: 'telegram-error', error: 'Not waiting for code' }));
            const poll = setInterval(() => {
              if (telegramService.getStatus() === 'online') {
                clearInterval(poll);
                ws.send(JSON.stringify({ type: 'telegram-step', step: 'done' }));
                broadcastState();
              } else if (telegramService.isWaitingForPassword()) {
                clearInterval(poll);
                ws.send(JSON.stringify({ type: 'telegram-step', step: 'password' }));
              }
            }, 500);
            setTimeout(() => clearInterval(poll), 60000);
          }
          break;
        }
        case 'telegram-password': {
          if (msg.password) {
            const ok = telegramService.submitPassword(msg.password);
            if (!ok) ws.send(JSON.stringify({ type: 'telegram-error', error: 'Not waiting for password' }));
            const poll = setInterval(() => {
              if (telegramService.getStatus() === 'online') {
                clearInterval(poll);
                ws.send(JSON.stringify({ type: 'telegram-step', step: 'done' }));
                broadcastState();
              }
            }, 500);
            setTimeout(() => clearInterval(poll), 60000);
          }
          break;
        }
        case 'telegram-logout': {
          telegramService.stop();
          const { clearTelegramCredentials } = require('./telegramConfig');
          clearTelegramCredentials();
          log('Telegram: logged out');
          broadcastState();
          break;
        }
        // ── Factory reset (from virtual NoHack) ──
        case 'factory-reset': {
          log('Factory reset triggered from Virtual NoHack');
          telegramService.stop();
          const { clearTelegramCredentials: clearCreds } = require('./telegramConfig');
          clearCreds();
          log('Relay reset complete — Telegram session cleared');
          broadcastState();
          break;
        }
        // ── Virtual NoHack: send via Telegram ──
        case 'nohack-send': {
          if (msg.payload) {
            try {
              const parsed = JSON.parse(msg.payload);
              if (parsed.type !== 'ack') {
                const recipient = parsed.recipientTelegramId || 'Saved Messages';
                log(`NoHack → ${recipient}: ${parsed.tag || '?'}`);
              }
            } catch {}
            telegramService.sendNoHack(msg.payload);
          }
          break;
        }
      }
    } catch {}
  });
});

// ── Forward incoming Telegram to WebSocket (for virtual NoHack) ─────────────

telegramService.onIncoming = (data) => {
  // Skip ACKs from log noise
  if (data.type === 'ack') {
    broadcast({ type: 'nohack-incoming', data });
    return;
  }
  const name = data.senderName || (data.senderPublicKey ? require('./deviceName').keyToName(data.senderPublicKey) : '?');
  const msgType = data.type === 'introduction' ? 'intro' : 'msg';
  log(`${name} → NoHack: ${data.tag || '?'} (${msgType})`);
  broadcast({ type: 'nohack-incoming', data });
};

telegramService.onLog = (msg) => {
  const time = new Date().toLocaleTimeString();
  broadcast({ type: 'log', message: msg, time });
};

telegramService.onAutoCode = (code) => {
  broadcast({ type: 'telegram-autocode', code });
};

// ── Windows notification ─────────────────────────────────────────────────────

function showNotification(title, message) {
  try {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.Visible = $true
$notify.BalloonTipTitle = '${title.replace(/'/g, "''")}'
$notify.BalloonTipText = '${message.replace(/'/g, "''")}'
$notify.ShowBalloonTip(5000)
Start-Sleep -Seconds 6
$notify.Dispose()
`.trim();
    const { spawn } = require('child_process');
    const proc = spawn('powershell', ['-NoProfile', '-Command', ps], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    proc.unref();
  } catch {}
}

// ── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Another relay may be running.`);
      console.error('Close the other instance and try again.');
      exec(`start http://127.0.0.1:${PORT}`);
    } else {
      console.error(`Server error: ${err.message}`);
    }
    console.error('\nPress any key to close...');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
  });

  // Init Telegram service (no relay instance needed — virtual relay has no physical device)
  telegramService.init(null).catch(err => {
    log(`Telegram init error: ${err.message}`);
  });

  server.listen(PORT, '127.0.0.1', () => {
    log(`NoHack Virtual Relay started on http://127.0.0.1:${PORT}`);

    if (process.platform === 'win32') {
      exec(`start http://127.0.0.1:${PORT}`);
    } else if (process.platform === 'darwin') {
      exec(`open http://127.0.0.1:${PORT}`);
    } else {
      exec(`xdg-open http://127.0.0.1:${PORT}`);
    }
  });
}

// ── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  log('Shutting down...');
  telegramService.stop();
  server.close();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error(`\nUnexpected error: ${err.message}`);
  console.error('\nPress any key to close...');
  try { process.stdin.setRawMode(true); } catch {}
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(1));
});

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  console.error('\nPress any key to close...');
  try { process.stdin.setRawMode(true); } catch {}
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(1));
});
