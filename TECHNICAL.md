# NoHack Technical Architecture

## Overview

NoHack is a paired-device messaging system that eliminates remote attack surface by keeping plaintext exclusively on an air-gapped (offline) phone. Messages are end-to-end encrypted — the online device never sees plaintext.

**Sold as a kit:**
- **NoHack phone** — offline, air-gapped, stores keys and contacts, the brain
- **Relay phone** — online, disposable, connects to Telegram, dumb pipe

The two phones connect via USB-C male-to-male cable. No setup required — plug in and it works.

---

## Device Architecture

```
┌─────────────────────┐    USB-C     ┌─────────────────────┐
│     NoHack Phone    │◄────────────►│     Relay Phone     │
│  (air-gapped)       │              │  (internet)         │
│                     │              │                     │
│  - Private keys     │  Encrypted   │  - Telegram client  │
│  - Contacts         │  JSON only   │  - No contacts      │
│  - Plaintext msgs   │◄────────────►│  - No keys          │
│  - Encryption       │              │  - No plaintext     │
│  - Decryption       │              │  - Stateless pipe   │
│                     │              │                     │
│  Package:           │              │  Package:           │
│  com.nohack         │              │  com.nohack.relay   │
└─────────────────────┘              └─────────────────────┘
```

### Virtual Counterparts (Development/Testing)

- **Virtual NoHack** — web app (`web/index.html`), connects to Virtual Relay via WebSocket
- **Virtual Relay** — Node.js server (`relay/src/server.js`), port 19847

Virtual and Real relays share the same Telegram account. Messages between them pass through Telegram Saved Messages (same account = messages to self).

---

## Encryption

**Algorithm:** NaCl box (Curve25519 + XSalsa20-Poly1305) via `tweetnacl`

**Key generation:** On first launch, NoHack generates a Curve25519 keypair.
- Public key → AsyncStorage (`@nohack_public_key`)
- Secret key → Android Keychain (primary), AsyncStorage fallback

**Forward secrecy:** Each outgoing message uses a fresh ephemeral keypair. The encrypted payload is:

```
base64( ephemeralPublicKey[32] + nonce[24] + ciphertext[...] )
```

**Decryption:** NoHack extracts the ephemeral public key and nonce from the packed payload, performs `nacl.box.open` with its own secret key. If decryption fails (wrong recipient), throws `DecryptionError` and silently drops the message.

**What the Relay sees:** Only the base64-encoded encrypted blob. It cannot:
- Decrypt messages (no secret key)
- Forge messages (no sender's secret key)
- Read any content (no access to plaintext at any stage)

---

## Message Protocol

### .nohack v3 Format

Every message is a JSON object with these required fields:

```json
{
  "nohack": "3",
  "id": "m1a2b3c4d5",
  "tag": "RFV",
  ...
}
```

| Field | Description |
|-------|-------------|
| `nohack` | Protocol version, always `"3"` |
| `id` | Unique message ID (`timestamp36 + random`) |
| `tag` | 3-letter tracking code (A-Z, no I/O), for log correlation |
| `type` | `"introduction"`, `"ack"`, or absent (encrypted message) |
| `payload` | Base64-encoded encrypted content (for messages) |
| `senderPublicKey` | Sender's NaCl public key (base64) |
| `recipient` | Recipient's public key |
| `recipientTelegramId` | Routing: which Telegram user to send to |
| `relayTelegramId` | Attached by Relay: its Telegram username |

### Inner Payload (after decryption)

```json
{
  "type": "message",
  "senderPublicKey": "base64...",
  "contentType": "text|image|voice|video|mixed",
  "body": "..."
}
```

For `mixed`: body is `{"text": "...", "image": "base64..."}`

### Transport Protocol

Newline-delimited JSON over USB. Commands:

| Command | Direction | Purpose |
|---------|-----------|---------|
| `decrypt` | Relay → NoHack | Deliver encrypted message |
| `introduction` | Relay → NoHack | Deliver contact card |
| `ping` | Relay → NoHack | Check if NoHack is alive |
| `ack` | NoHack → Relay | Acknowledge ping |
| `encrypted` | NoHack → Relay | Send encrypted message out |

---

## USB Communication

### Android Open Accessory (AOA) Protocol

- **Relay** = USB Host (initiates AOA handshake)
- **NoHack** = USB Accessory (responds)
- An OTG adapter on the Relay forces deterministic host role

### Data Flow

```
Relay (Host)                          NoHack (Accessory)
UsbHostModule.kt ──────────────────► UsbConnectionModule.kt
   bulkTransfer()                        inputStream.read()
   (16KB chunks)                         (16KB buffer)
        │                                      │
        ▼                                      ▼
RelayUsbService.ts                     UsbService.ts
   write()                              handleData()
   newline-delimited                     extractLines()
   JSON                                  parseTransportLine()
        │                                      │
        ▼                                      ▼
RelayMainScreen.tsx                    ChatListScreen.tsx
   message router                       message router
```

### Hardening

- **USB filter**: Only accepts `manufacturer="NoHack" model="NoHack Relay"` — no wildcard
- **Buffer cap**: 1 MB max buffer size; drops data if exceeded (prevents memory exhaustion)
- **Command whitelist**: Only `decrypt`, `introduction`, `ping` accepted
- **No code execution**: No eval, no dynamic requires, no shell access over USB

---

## Routing Architecture

### Contacts

NoHack stores all contact data:
- `publicKey` — NaCl public key (base64), used as contact ID
- `name` — deterministic name from `keyToName()` (hash of public key → "AdjectiveNoun123")
- `telegramId` — the contact's relay's Telegram username (for routing replies)

Relay stores nothing — zero contact data, zero routing tables.

### Message Flow (Outgoing)

```
1. NoHack encrypts message with recipient's public key
2. NoHack attaches recipientTelegramId (from contact store)
3. NoHack sends via USB to Relay
4. Relay reads recipientTelegramId, strips it
5. Relay attaches own relayTelegramId
6. Relay sends .nohack file to recipient's Telegram
```

### Message Flow (Incoming)

```
1. Telegram message arrives at Relay (via NewMessage event)
2. Relay validates .nohack v3 format
3. Relay forwards to NoHack via USB (with relayTelegramId intact)
4. NoHack attempts decryption
5. If successful: stores message, extracts senderPublicKey, saves relayTelegramId in contact
6. If failed: silently drops (not addressed to us)
```

### Saved Messages Bridge (Virtual ↔ Real)

Both Virtual Relay and Real Relay share the same Telegram account (@Kikkert888). Messages between virtual and real NoHack pass through Telegram Saved Messages:

```
Virtual NoHack → Virtual Relay → Saved Messages → Real Relay → Real NoHack
                                                                    │
Real NoHack → Real Relay → Saved Messages → Virtual Relay → Virtual NoHack
```

GramJS `NewMessage` events don't fire for messages sent by another client on the same account. Both relays poll Saved Messages every 5 seconds to catch cross-relay messages.

---

## Acknowledgement System

| Status | Symbol | Meaning |
|--------|--------|---------|
| Queued | ○ | Not yet sent (USB disconnected) |
| Sent | ✓ | Delivered to Relay |
| Received | ✓✓ (grey) | Relay delivered to recipient's NoHack |
| Read | ✓✓ (blue) | Recipient opened the chat |

**Hardening:** Read ACKs only sent when `AppState === 'active'` (screen is on and app is in foreground). Messages received while screen is off get grey ✓✓ (received) but not blue ✓✓ (read) until the user actually looks at them.

---

## Security Model

### Threat Model

The Relay phone is assumed compromisable. It has internet access, runs Telegram, and is exposed to all remote attack vectors. The security model assumes a fully compromised Relay.

### What a compromised Relay CANNOT do

| Attack | Why it fails |
|--------|-------------|
| Read messages | NaCl box encryption; Relay has no secret key |
| Forge messages from another user | Needs sender's secret key for inner payload |
| Execute code on NoHack | USB protocol only accepts 3 JSON commands |
| Access NoHack filesystem | Android Accessory mode is app-level I/O only |
| Install malware on NoHack | No ADB/MTP/PTP over accessory connection |
| Brute-force decryption | Ephemeral keys per message; Curve25519 strength |

### What a compromised Relay CAN do (mitigated)

| Attack | Mitigation |
|--------|-----------|
| Inject fake introduction (attacker's public key) | New contacts show verification warning: "Verify this person out-of-band before sharing secrets" |
| Redirect replies by changing relayTelegramId | relayTelegramId changes are logged with console.warn |
| Impersonate Relay via USB | USB filter requires exact manufacturer/model match |
| Memory exhaustion via unbounded data | USB buffer capped at 1 MB |
| Denial of service (crash app) | All JSON parsing wrapped in try-catch |

### Remaining Trust Assumptions

1. **Physical USB cable** — assumed to be a passive cable, not a malicious device
2. **First contact** — initial key exchange requires out-of-band verification (user must confirm the contact is who they claim to be)
3. **Android OS** — the NoHack phone's OS is trusted (it's offline, so remote compromise is impossible, but physical access is still a risk)
4. **Relay swappability** — Relay can be replaced anytime; NoHack keeps all contacts and keys

---

## Telegram Integration

- **Library:** GramJS (`telegram` npm package, v2.26.22)
- **Transport:** WebSocket (`useWSS: true`, `ConnectionTCPObfuscated`) on Android; direct TCP on Node.js
- **API credentials:** api_id=37345390
- **Patch:** `patches/telegram+2.26.22.patch` — critical for Hermes compatibility
- **Polyfill:** `Symbol.asyncIterator` polyfilled for Hermes (GramJS `getMessages` needs it)

### Message Delivery

- Outgoing: sent as `.nohack` file attachment via `client.sendFile()`
- Incoming: received via `NewMessage` event handler
- Cross-relay: polled from Saved Messages every 5 seconds

---

## Build System

### Android

Two product flavors in `android/app/build.gradle`:

| Flavor | Package | Entry Point |
|--------|---------|-------------|
| `nohack` | `com.nohack` | `index.js` → `App.tsx` |
| `relay` | `com.nohack.relay` | `index.relay.js` → `RelayApp.tsx` |

```bash
# Build both
./gradlew assembleNohackDebug assembleRelayDebug

# Build release (ADB disabled)
./gradlew assembleNohackRelease assembleRelayRelease
```

### Key Files

**NoHack App:**
| File | Purpose |
|------|---------|
| `src/screens/ChatListScreen.tsx` | Message router, USB listener, contact list |
| `src/screens/ChatScreen.tsx` | Conversation view, compose bar |
| `src/crypto/keys.ts` | NaCl keypair, encrypt/decrypt |
| `src/store/contactStore.ts` | Contact persistence (AsyncStorage) |
| `src/store/chatState.ts` | Message persistence, unread counts |
| `src/services/UsbService.ts` | USB accessory listener |
| `src/utils/nohack.ts` | .nohack file format, transport protocol |

**Relay App:**
| File | Purpose |
|------|---------|
| `src/relay/screens/RelayMainScreen.tsx` | Status display, auto-start USB |
| `src/relay/services/RelayUsbService.ts` | USB host mode |
| `src/relay/services/RelayTelegramService.ts` | GramJS client, Saved Messages polling |

**Android Native:**
| File | Purpose |
|------|---------|
| `android/.../UsbConnectionModule.kt` | USB accessory bridge (NoHack) |
| `android/.../relay/UsbHostModule.kt` | USB host + AOA handshake (Relay) |
| `android/.../UsbForegroundService.kt` | Keep USB alive in background |

**Virtual Relay:**
| File | Purpose |
|------|---------|
| `relay/src/server.js` | Express + WebSocket server |
| `relay/src/telegramService.js` | GramJS client (Node.js) |
| `web/index.html` | Virtual NoHack web interface |

---

## Contact Identification

`keyToName(publicKey)` generates a deterministic human-readable name from a public key:

```
hash(publicKey) → "BrightFox482"
```

Format: `Adjective` + `Noun` + 3 digits. Same key always produces the same name. This is NOT authentication — it's a convenience label. Users must verify contacts through a separate channel.

---

## Data Persistence

| Data | Storage | Device |
|------|---------|--------|
| Private key | Android Keychain + AsyncStorage fallback | NoHack only |
| Public key | AsyncStorage | NoHack only |
| Contacts | AsyncStorage (`@nohack_contacts`) | NoHack only |
| Messages | AsyncStorage (per-contact arrays) | NoHack only |
| Telegram session | AsyncStorage | Relay only |
| Nothing else | — | Relay stores nothing |

---

## Styling

Dark theme matching WhatsApp:
- Background: `#0B141A`
- Header/compose: `#1F2C34`
- Accent: `#4CAF50` (green)
- Send button: `#00A884`
- Outgoing bubble: `#005C4B`
- Incoming bubble: `#1F2C34`
- Read ticks: `#53BDEB` (blue)
