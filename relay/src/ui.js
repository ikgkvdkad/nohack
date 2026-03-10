function getHtmlPage(port) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NoHack Virtual Relay</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', -apple-system, sans-serif;
    background: #0F0F1A;
    color: #FFFFFF;
    min-height: 100vh;
    display: flex;
    justify-content: center;
  }
  #app {
    width: 100%;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  /* ── Header ────────────────────────── */
  .app-header {
    padding: 18px 20px;
    background: #16162A;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .app-header h1 {
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 2px;
    color: #FFFFFF;
  }
  .app-header h1 span { color: #4CAF50; font-weight: 600; }
  .app-header h1 .no { color: #E53935; }
  .app-header .subtitle {
    font-size: 11px;
    color: #666;
    letter-spacing: 1px;
    margin-top: 4px;
  }

  /* ── Status card ─────────────────────── */
  .status-section { padding: 12px 20px 0; flex-shrink: 0; }
  .status-card {
    background: rgba(255,255,255,0.05);
    border-radius: 12px;
    padding: 16px;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .status-dot {
    width: 12px; height: 12px; border-radius: 50%;
    flex-shrink: 0;
  }
  .status-dot.green { background: #4CAF50; }
  .status-dot.yellow { background: #FFC107; }
  .status-dot.red { background: #E53935; }
  .status-dot.gray { background: #555; }
  .status-dot.pulse {
    background: #FFC107;
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  .status-info { flex: 1; }
  .status-name {
    font-size: 16px;
    font-weight: 600;
  }
  .status-label {
    font-size: 12px;
    color: #666;
    margin-top: 2px;
  }

  /* ── Log area ────────────────────────── */
  .log-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 12px 20px 20px;
  }
  .log-label {
    font-size: 11px;
    color: #444;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 8px;
    flex-shrink: 0;
  }
  .log-box {
    background: rgba(0,0,0,0.25);
    border-radius: 10px;
    padding: 12px 14px;
    flex: 1;
    overflow-y: auto;
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.7;
    color: #777;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .log-box .log-inner {
    display: flex;
    flex-direction: column;
  }
  .log-box .time { color: #444; }
  .log-box .highlight { color: #4CAF50; font-weight: 500; }

  /* ── Telegram section ─────────────────── */
  .telegram-section { padding: 12px 20px 0; flex-shrink: 0; }

  .telegram-card {
    background: rgba(255,255,255,0.05);
    border-radius: 12px;
    padding: 14px 16px;
  }
  .telegram-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .telegram-info { flex: 1; }
  .telegram-name { font-size: 14px; font-weight: 600; }
  .telegram-label { font-size: 11px; color: #666; margin-top: 2px; }
  .telegram-setup {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .telegram-input {
    background: rgba(255,255,255,0.07);
    border: none;
    border-radius: 8px;
    padding: 10px 14px;
    color: #fff;
    font-size: 14px;
    font-family: inherit;
    outline: none;
    letter-spacing: 1px;
  }
  .telegram-input::placeholder { color: #555; }
  .btn-telegram {
    background: #4CAF50;
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 10px 18px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .btn-telegram:hover { opacity: 0.85; }
  .btn-telegram:disabled { opacity: 0.5; cursor: default; }
  .telegram-error { color: #E53935; font-size: 12px; margin-top: 4px; }
  .btn-logout {
    background: rgba(229,57,53,0.12);
    color: #E53935;
    border: none;
    border-radius: 8px;
    padding: 7px 14px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }

  /* ── Kill switch ─────────────────────── */
  .kill-switch-wrapper {
    padding: 12px 20px 0;
  }
  .kill-switch-track {
    height: 44px;
    border-radius: 22px;
    background: rgba(229,57,53,0.15);
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    user-select: none;
    touch-action: none;
  }
  .kill-switch-label {
    color: rgba(229,57,53,0.7);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 3px;
    pointer-events: none;
  }
  .kill-switch-thumb {
    width: 44px;
    height: 44px;
    border-radius: 22px;
    background: #E53935;
    color: #fff;
    font-size: 14px;
    font-weight: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    left: 0;
    top: 0;
    cursor: grab;
    box-shadow: 0 2px 8px rgba(229,57,53,0.4);
    transition: none;
  }
  .kill-switch-thumb.snap-back {
    transition: left 0.3s ease;
  }

</style>
</head>
<body>
<div id="app">
  <div class="app-header">
    <h1><span class="no">NO</span>HACK <span>RELAY</span></h1>
    <div class="subtitle">VIRTUAL — Saved Messages bridge</div>
  </div>

  <!-- Kill switch -->
  <div class="kill-switch-wrapper">
    <div class="kill-switch-track" id="killTrack">
      <span class="kill-switch-label" id="killLabel">SLIDE TO RESET</span>
      <div class="kill-switch-thumb" id="killThumb"></div>
    </div>
  </div>

  <!-- Status: always ready (no physical device needed) -->
  <div class="status-section">
    <div class="status-card">
      <div class="status-dot green"></div>
      <div class="status-info">
        <div class="status-name">Virtual Relay</div>
        <div class="status-label">Bridges Virtual NoHack via Telegram Saved Messages</div>
      </div>
    </div>
  </div>

  <!-- Telegram -->
  <div class="telegram-section">
    <div class="telegram-card">
      <div class="telegram-row">
        <div class="status-dot gray" id="tg-dot"></div>
        <div class="telegram-info">
          <div class="telegram-name" id="tg-name">Telegram</div>
          <div class="telegram-label" id="tg-label">Not configured</div>
        </div>
        <button class="btn-logout" id="tg-logout" style="display:none" onclick="tgLogout()">Logout</button>
      </div>
      <div class="telegram-setup" id="tg-setup">
        <input class="telegram-input" id="tg-phone" placeholder="+31 6 12345678" />
        <button class="btn-telegram" id="tg-btn" onclick="tgAction()">Login with Telegram</button>
        <div class="telegram-error" id="tg-error"></div>
      </div>
    </div>
  </div>

  <!-- Log area -->
  <div class="log-area">
    <div class="log-label">Activity</div>
    <div class="log-box" id="log-box"><div class="log-inner" id="log-inner"></div></div>
  </div>
</div>

<script>
  const logBox = document.getElementById('log-box');
  const logInner = document.getElementById('log-inner');
  let ws;

  function addLog(time, message) {
    const line = document.createElement('div');
    const isHighlight = message.includes('Telegram') || message.includes('→')
      || message.includes('Saved') || message.includes('online');
    line.innerHTML = '<span class="time">[' + time + ']</span> ' +
      (isHighlight ? '<span class="highlight">' + esc(message) + '</span>' : esc(message));
    logInner.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // ── Telegram UI ─────────────────────────
  let tgStep = 'phone';

  function updateTelegramUI(status, id) {
    const dot = document.getElementById('tg-dot');
    const name = document.getElementById('tg-name');
    const label = document.getElementById('tg-label');
    const setup = document.getElementById('tg-setup');
    const logout = document.getElementById('tg-logout');

    dot.className = 'status-dot ' + (status === 'online' ? 'green' : status === 'connecting' ? 'pulse' : 'gray');

    if (status === 'online' && id) {
      name.textContent = id;
      label.textContent = 'Online — watching Saved Messages';
      setup.style.display = 'none';
      logout.style.display = 'block';
    } else if (status === 'connecting') {
      name.textContent = 'Telegram';
      label.textContent = 'Connecting...';
    } else {
      name.textContent = 'Telegram';
      label.textContent = 'Not configured';
      if (tgStep === 'phone') setup.style.display = 'flex';
      logout.style.display = 'none';
    }
  }

  function tgAction() {
    const btn = document.getElementById('tg-btn');
    const err = document.getElementById('tg-error');
    err.textContent = '';

    if (tgStep === 'phone') {
      const phone = document.getElementById('tg-phone').value.trim();
      if (!phone) { err.textContent = 'Enter phone number'; return; }
      btn.disabled = true;
      btn.textContent = 'Sending...';
      send({ cmd: 'telegram-code', phone });
    } else if (tgStep === 'code') {
      const code = document.getElementById('tg-phone').value.trim();
      if (!code) { err.textContent = 'Enter verification code'; return; }
      btn.disabled = true;
      btn.textContent = 'Verifying...';
      send({ cmd: 'telegram-verify', code });
    } else if (tgStep === 'password') {
      const pw = document.getElementById('tg-phone').value.trim();
      if (!pw) { err.textContent = 'Enter 2FA password'; return; }
      btn.disabled = true;
      btn.textContent = 'Submitting...';
      send({ cmd: 'telegram-password', password: pw });
    }
  }

  function tgLogout() {
    send({ cmd: 'telegram-logout' });
    tgStep = 'phone';
    document.getElementById('tg-phone').value = '';
    document.getElementById('tg-phone').placeholder = '+31 6 12345678';
    document.getElementById('tg-phone').type = 'text';
    document.getElementById('tg-btn').textContent = 'Login with Telegram';
    document.getElementById('tg-btn').disabled = false;
    document.getElementById('tg-setup').style.display = 'flex';
    document.getElementById('tg-error').textContent = '';
  }

  function handleTelegramStep(step) {
    const input = document.getElementById('tg-phone');
    const btn = document.getElementById('tg-btn');
    btn.disabled = false;

    if (step === 'code') {
      tgStep = 'code';
      input.value = '';
      input.placeholder = 'Verification code';
      input.type = 'text';
      btn.textContent = 'Verify';
    } else if (step === 'password') {
      tgStep = 'password';
      input.value = '';
      input.placeholder = '2FA password';
      input.type = 'password';
      btn.textContent = 'Submit';
    } else if (step === 'done') {
      tgStep = 'done';
      document.getElementById('tg-setup').style.display = 'none';
    }
  }

  // ── Kill switch ─────────────────────────
  (function() {
    const track = document.getElementById('killTrack');
    const thumb = document.getElementById('killThumb');
    const label = document.getElementById('killLabel');
    let dragging = false, startX = 0, activated = false;

    thumb.addEventListener('pointerdown', (e) => {
      if (activated) return;
      dragging = true;
      startX = e.clientX;
      thumb.setPointerCapture(e.pointerId);
      thumb.classList.remove('snap-back');
    });

    thumb.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const maxX = track.offsetWidth - 44;
      const dx = Math.max(0, Math.min(e.clientX - startX, maxX));
      thumb.style.left = dx + 'px';
      const pct = dx / maxX;
      track.style.background = 'rgba(229,57,53,' + (0.15 + pct * 0.45).toFixed(2) + ')';
    });

    thumb.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      const maxX = track.offsetWidth - 44;
      const dx = parseInt(thumb.style.left) || 0;
      if (dx >= maxX * 0.9) {
        activated = true;
        thumb.style.left = maxX + 'px';
        label.textContent = 'RESETTING...';
        send({ cmd: 'factory-reset' });
        setTimeout(() => {
          tgLogout();
          activated = false;
          thumb.classList.add('snap-back');
          thumb.style.left = '0px';
          track.style.background = '';
          label.textContent = 'SLIDE TO RESET';
        }, 1500);
      } else {
        thumb.classList.add('snap-back');
        thumb.style.left = '0px';
        track.style.background = '';
      }
    });
  })();

  function connect() {
    ws = new WebSocket('ws://localhost:${port}');
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state') {
        updateTelegramUI(msg.telegramStatus, msg.telegramId);
      } else if (msg.type === 'log') {
        addLog(msg.time, msg.message);
      } else if (msg.type === 'telegram-step') {
        handleTelegramStep(msg.step);
      } else if (msg.type === 'telegram-error') {
        document.getElementById('tg-error').textContent = msg.error;
        document.getElementById('tg-btn').disabled = false;
      } else if (msg.type === 'telegram-autocode') {
        // Auto-fill the verification code
        if (tgStep === 'code') {
          document.getElementById('tg-phone').value = msg.code;
          document.getElementById('tg-btn').disabled = true;
          document.getElementById('tg-btn').textContent = 'Auto-verifying...';
        }
      }
    };
    ws.onclose = () => setTimeout(connect, 2000);
  }

  connect();
</script>
</body>
</html>`;
}

module.exports = { getHtmlPage };
