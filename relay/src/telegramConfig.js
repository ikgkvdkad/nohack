const fs = require('fs');
const path = require('path');
const { APP_DIR } = require('./config');

const TELEGRAM_FILE = path.join(APP_DIR, 'telegram.json');
const CONTACTS_FILE = path.join(APP_DIR, 'telegram-contacts.json');

function loadTelegramCredentials() {
  try {
    return JSON.parse(fs.readFileSync(TELEGRAM_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveTelegramCredentials(creds) {
  fs.writeFileSync(TELEGRAM_FILE, JSON.stringify(creds, null, 2), 'utf8');
}

function clearTelegramCredentials() {
  try { fs.unlinkSync(TELEGRAM_FILE); } catch {}
}

function loadTelegramContacts() {
  try {
    return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveTelegramContacts(contacts) {
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2), 'utf8');
}

module.exports = {
  loadTelegramCredentials,
  saveTelegramCredentials,
  clearTelegramCredentials,
  loadTelegramContacts,
  saveTelegramContacts,
};
