import AsyncStorage from '@react-native-async-storage/async-storage';

const CONTACTS_KEY = '@nohack_contacts';

export interface Contact {
  publicKey: string;
  name: string;
  telegramId?: string;
  createdAt: number;
}

let contacts: Contact[] = [];
let loaded = false;

export async function loadContacts(): Promise<Contact[]> {
  if (loaded) return contacts;
  try {
    const raw = await AsyncStorage.getItem(CONTACTS_KEY);
    contacts = raw ? JSON.parse(raw) : [];
  } catch {
    contacts = [];
  }
  loaded = true;
  return contacts;
}

async function persist(): Promise<void> {
  await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
}

export function getContacts(): Contact[] {
  return contacts;
}

export function getContact(publicKey: string): Contact | undefined {
  return contacts.find(c => c.publicKey === publicKey);
}

export async function addOrUpdateContact(
  publicKey: string,
  name: string,
  telegramId?: string,
): Promise<Contact> {
  const existing = contacts.find(c => c.publicKey === publicKey);
  if (existing) {
    // Update name if sender changed it
    if (name && name !== existing.name) {
      existing.name = name;
    }
    if (telegramId && !existing.telegramId) {
      existing.telegramId = telegramId;
    } else if (telegramId && existing.telegramId && telegramId !== existing.telegramId) {
      console.warn(
        `[ContactStore] relayTelegramId changed for ${name}: ` +
        `${existing.telegramId} → ${telegramId}`,
      );
      existing.telegramId = telegramId;
    }
    await persist();
    return existing;
  }
  const contact: Contact = {publicKey, name, telegramId, createdAt: Date.now()};
  contacts.push(contact);
  await persist();
  return contact;
}

export async function removeContact(publicKey: string): Promise<void> {
  contacts = contacts.filter(c => c.publicKey !== publicKey);
  await persist();
}

export async function clearAllContacts(): Promise<void> {
  contacts = [];
  await AsyncStorage.removeItem(CONTACTS_KEY);
}
