import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Selected device (legacy, no longer used with USB) ────────────────────────

const SELECTED_DEVICE_KEY = '@relay_selected_device';

interface SelectedDevice {
  address: string;
  name: string;
}

export async function getSelectedDevice(): Promise<SelectedDevice | null> {
  const json = await AsyncStorage.getItem(SELECTED_DEVICE_KEY);
  return json ? JSON.parse(json) : null;
}

export async function saveSelectedDevice(device: SelectedDevice): Promise<void> {
  await AsyncStorage.setItem(SELECTED_DEVICE_KEY, JSON.stringify(device));
}

// ── Telegram credentials ────────────────────────────────────────────────────

const TELEGRAM_CREDS_KEY = '@relay_telegram_credentials';

export interface TelegramCredentials {
  sessionString: string; // GramJS StringSession (persists auth)
  phoneNumber: string;
  username: string; // @username for display & contact exchange
}

export async function getTelegramCredentials(): Promise<TelegramCredentials | null> {
  const json = await AsyncStorage.getItem(TELEGRAM_CREDS_KEY);
  return json ? JSON.parse(json) : null;
}

export async function saveTelegramCredentials(creds: TelegramCredentials): Promise<void> {
  await AsyncStorage.setItem(TELEGRAM_CREDS_KEY, JSON.stringify(creds));
}

export async function clearTelegramCredentials(): Promise<void> {
  await AsyncStorage.removeItem(TELEGRAM_CREDS_KEY);
}

// ── Telegram contacts ───────────────────────────────────────────────────────

const TELEGRAM_CONTACTS_KEY = '@relay_telegram_contacts';

export interface TelegramContact {
  publicKey: string;  // NoHack public key (base64)
  telegramId: string; // Telegram username or numeric ID
}

export async function getTelegramContacts(): Promise<TelegramContact[]> {
  const json = await AsyncStorage.getItem(TELEGRAM_CONTACTS_KEY);
  return json ? JSON.parse(json) : [];
}

export async function saveTelegramContacts(contacts: TelegramContact[]): Promise<void> {
  await AsyncStorage.setItem(TELEGRAM_CONTACTS_KEY, JSON.stringify(contacts));
}
