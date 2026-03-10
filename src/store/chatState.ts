import AsyncStorage from '@react-native-async-storage/async-storage';

const MESSAGES_KEY = '@nohack_messages';
const OUTBOX_KEY = '@nohack_outbox';

export type MessageStatus = 'queued' | 'sent' | 'received' | 'read';

export interface ChatMessage {
  id: string;
  contactKey: string; // public key of the other party
  direction: 'in' | 'out';
  contentType: 'text' | 'image' | 'mixed' | 'voice' | 'video';
  text?: string;
  image?: string;
  voice?: string; // base64 audio
  video?: string; // base64 video
  tag: string;
  timestamp: number;
  isIntroduction?: boolean;
  status?: MessageStatus; // only for outgoing messages
}

// Outbox entry: a message waiting to be sent via USB
export interface OutboxEntry {
  id: string; // matches ChatMessage.id
  contactKey: string;
  btPayload: string; // serialized TransportResponse JSON (kept as btPayload for storage compat)
}

type Listener = () => void;

// All messages grouped by contact public key
const messages: Map<string, ChatMessage[]> = new Map();
const unreadCounts: Map<string, number> = new Map();
const listeners: Set<Listener> = new Set();
let loaded = false;

// Outbox: messages queued for sending
let outbox: OutboxEntry[] = [];

function notify() {
  listeners.forEach(fn => fn());
}

async function persist(): Promise<void> {
  const obj: Record<string, ChatMessage[]> = {};
  messages.forEach((msgs, key) => { obj[key] = msgs; });
  await AsyncStorage.setItem(MESSAGES_KEY, JSON.stringify(obj));
}

async function persistOutbox(): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
}

export async function loadMessages(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(MESSAGES_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, ChatMessage[]>;
      for (const [key, msgs] of Object.entries(obj)) {
        messages.set(key, msgs);
      }
    }
  } catch {}
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    if (raw) {
      outbox = JSON.parse(raw);
    }
  } catch {}
  loaded = true;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getMessages(contactKey: string): ChatMessage[] {
  return messages.get(contactKey) || [];
}

export function getUnreadCount(contactKey: string): number {
  return unreadCounts.get(contactKey) || 0;
}

export function getTotalUnread(): number {
  let total = 0;
  unreadCounts.forEach(v => (total += v));
  return total;
}

export function addMessage(msg: ChatMessage): void {
  const list = messages.get(msg.contactKey) || [];
  list.push(msg);
  messages.set(msg.contactKey, list);
  notify();
  persist();
}

export function addIncomingMessage(msg: ChatMessage, currentlyViewing?: string): void {
  addMessage(msg);
  if (msg.contactKey !== currentlyViewing) {
    unreadCounts.set(msg.contactKey, (unreadCounts.get(msg.contactKey) || 0) + 1);
  }
}

export function markRead(contactKey: string): void {
  if (unreadCounts.get(contactKey)) {
    unreadCounts.set(contactKey, 0);
    notify();
  }
}

export function getLastMessage(contactKey: string): ChatMessage | undefined {
  const list = messages.get(contactKey);
  return list && list.length > 0 ? list[list.length - 1] : undefined;
}

export function clearAllMessages(): void {
  messages.clear();
  unreadCounts.clear();
  outbox = [];
  notify();
  AsyncStorage.removeItem(MESSAGES_KEY);
  AsyncStorage.removeItem(OUTBOX_KEY);
}

// ── Message status updates ───────────────────────────────────────────────────

export function updateMessageStatus(messageIds: string[], newStatus: MessageStatus): void {
  let changed = false;
  messages.forEach(list => {
    for (const msg of list) {
      if (msg.direction === 'out' && messageIds.includes(msg.id)) {
        const statusOrder: MessageStatus[] = ['queued', 'sent', 'received', 'read'];
        const current = statusOrder.indexOf(msg.status || 'sent');
        const next = statusOrder.indexOf(newStatus);
        if (next > current) {
          msg.status = newStatus;
          changed = true;
        }
      }
    }
  });
  if (changed) {
    notify();
    persist();
  }
}

// ── Outbox (queued messages) ─────────────────────────────────────────────────

export function addToOutbox(entry: OutboxEntry): void {
  outbox.push(entry);
  persistOutbox();
}

export function getOutbox(): OutboxEntry[] {
  return [...outbox];
}

export function clearOutboxEntry(id: string): void {
  outbox = outbox.filter(e => e.id !== id);
  persistOutbox();
}

export function deleteQueuedMessage(id: string): void {
  // Remove from outbox
  outbox = outbox.filter(e => e.id !== id);
  persistOutbox();
  // Remove from messages
  messages.forEach((list, key) => {
    const idx = list.findIndex(m => m.id === id);
    if (idx !== -1) {
      list.splice(idx, 1);
      messages.set(key, list);
    }
  });
  notify();
  persist();
}

export function deleteChat(contactKey: string): void {
  messages.delete(contactKey);
  unreadCounts.delete(contactKey);
  outbox = outbox.filter(e => e.contactKey !== contactKey);
  notify();
  persist();
  persistOutbox();
}

// Get IDs of incoming messages from a contact that haven't been ack'd as 'received' yet
export function getUnackedIncomingIds(contactKey: string): string[] {
  const list = messages.get(contactKey) || [];
  return list
    .filter(m => m.direction === 'in' && !m.isIntroduction)
    .map(m => m.id);
}
