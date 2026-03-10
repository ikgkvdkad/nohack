const os = require('os');
const path = require('path');
const fs = require('fs');

function getAppDataDir() {
  const platform = os.platform();
  if (platform === 'win32') {
    return path.join(process.env.APPDATA, 'nohack-relay');
  } else if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'nohack-relay');
  } else {
    return path.join(os.homedir(), '.config', 'nohack-relay');
  }
}

const APP_DIR = getAppDataDir();
const INBOX = path.join(APP_DIR, 'inbox');
const OUTBOX = path.join(APP_DIR, 'outbox');
const SENT = path.join(APP_DIR, 'sent');
const CONFIG_FILE = path.join(APP_DIR, 'config.json');
const DOWNLOADS = path.join(os.homedir(), 'Downloads');

// Ensure directories exist
[APP_DIR, INBOX, OUTBOX, SENT].forEach(d => fs.mkdirSync(d, { recursive: true }));

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { nohackAddress: null, nohackName: null };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

module.exports = {
  APP_DIR,
  INBOX,
  OUTBOX,
  SENT,
  CONFIG_FILE,
  DOWNLOADS,
  loadConfig,
  saveConfig,
};
