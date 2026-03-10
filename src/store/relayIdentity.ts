// Stores the connected Relay's Telegram ID (received via USB identify command)
// This is ephemeral — only valid while USB is connected. Used for QR code generation.

let relayTelegramId: string | undefined;

export function setRelayTelegramId(id: string) {
  relayTelegramId = id;
}

export function getRelayTelegramId(): string | undefined {
  return relayTelegramId;
}

export function clearRelayTelegramId() {
  relayTelegramId = undefined;
}
