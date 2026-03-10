// ── Navigation ────────────────────────────────────────────────────────────────

export type RootStackParamList = {
  Setup: undefined;
  Pin: undefined;
  ChatList: undefined;
  Chat: {
    contactKey: string; // public key of contact
  };
  AddContact: undefined;
};

// ── .nohack file format v3 ──────────────────────────────────────────────────

export interface NoHackFile {
  nohack: '3';
  id: string;
  tag: string;
  // Introduction (plaintext):
  type?: 'introduction' | 'ack';
  senderPublicKey?: string;
  senderName?: string; // user-chosen display name
  // Encrypted message:
  payload?: string; // base64(ephemeralPub + nonce + ciphertext)
  recipient?: string; // recipient's public key (for routing)
  // Telegram transport:
  relayTelegramId?: string; // sender relay's Telegram username
  // Ack fields:
  ackType?: 'received' | 'read';
  ackIds?: string[];
}

// ── Inner payload (decrypted from payload field) ────────────────────────────

export interface InnerPayload {
  type: 'message';
  senderPublicKey: string;
  senderName?: string; // user-chosen display name
  contentType: 'text' | 'image' | 'mixed' | 'voice' | 'video';
  body: string;
}

// ── Transport protocol (USB) ─────────────────────────────────────────────────

// Relay → NoHack
export interface TransportCommand {
  cmd: 'decrypt' | 'introduction' | 'ping' | 'identify' | 'factory_reset';
  payload?: string; // .nohack file JSON string for decrypt/introduction
  relayTelegramId?: string; // sent with 'identify' so NoHack knows its relay's address
}

// NoHack → Relay
export interface TransportResponse {
  cmd: 'encrypted' | 'introduction' | 'ack' | 'factory_reset';
  payload?: string; // .nohack file JSON string
  deviceName?: string; // included in ack so relay knows our display name
}
