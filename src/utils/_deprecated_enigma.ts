import {NoHackFile, InnerPayload, BluetoothCommand, BluetoothResponse} from '../types';

// ── ID & tag generation ──────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function generateTag(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O to avoid confusion
  let tag = '';
  for (let i = 0; i < 3; i++) {
    tag += chars[Math.floor(Math.random() * chars.length)];
  }
  return tag;
}

// ── Create v3 .nohack files ─────────────────────────────────────────────────

export function createMessage(encryptedPayload: string, recipient?: string, senderPublicKey?: string): NoHackFile {
  const file: NoHackFile = {
    tag: generateTag(),
    nohack: '3',
    id: generateId(),
    payload: encryptedPayload,
  };
  if (recipient) file.recipient = recipient;
  if (senderPublicKey) file.senderPublicKey = senderPublicKey;
  return file;
}

export function createIntroduction(publicKey: string): NoHackFile {
  return {
    tag: generateTag(),
    nohack: '3',
    id: generateId(),
    type: 'introduction',
    senderPublicKey: publicKey,
  };
}

export function createAck(
  ackType: 'received' | 'read',
  ackIds: string[],
): NoHackFile {
  return {
    tag: 'ACK',
    nohack: '3',
    id: generateId(),
    type: 'ack',
    ackType,
    ackIds,
  };
}

// ── Inner payload packing/unpacking ─────────────────────────────────────────

export function packInnerPayload(
  senderPublicKey: string,
  contentType: 'text' | 'image' | 'mixed' | 'voice' | 'video',
  body: string,
): string {
  const inner: InnerPayload = {
    type: 'message',
    senderPublicKey,
    contentType,
    body,
  };
  return JSON.stringify(inner);
}

export function unpackInnerPayload(json: string): InnerPayload {
  const data = JSON.parse(json);
  if (data.type !== 'message' || !data.senderPublicKey || !data.body) {
    throw new Error('Invalid inner payload');
  }
  return data as InnerPayload;
}

// ── Parse v3 .nohack files ──────────────────────────────────────────────────

export function parseNoHackFile(json: string): NoHackFile | null {
  try {
    const data = JSON.parse(json.trim());
    if (data.nohack === '3' && data.id && data.tag) {
      return data as NoHackFile;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Bluetooth protocol serialization ──────────────────────────────────────────

export function serializeForBluetooth(obj: BluetoothCommand | BluetoothResponse): string {
  return JSON.stringify(obj) + '\n';
}

export function parseBluetoothLine(line: string): BluetoothCommand | BluetoothResponse | null {
  try {
    const data = JSON.parse(line.trim());
    if (data.cmd) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Buffer parsing (newline-delimited) ────────────────────────────────────────

export function extractLines(buffer: string): {
  lines: string[];
  remaining: string;
} {
  const parts = buffer.split('\n');
  const lines: string[] = [];

  for (let i = 0; i < parts.length - 1; i++) {
    const line = parts[i].trim();
    if (line) lines.push(line);
  }

  return {lines, remaining: parts[parts.length - 1]};
}
