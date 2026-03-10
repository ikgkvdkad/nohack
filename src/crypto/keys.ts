import 'react-native-get-random-values';
import nacl from 'tweetnacl';
import {encodeBase64, decodeBase64, encodeUTF8, decodeUTF8} from 'tweetnacl-util';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

const PUBLIC_KEY_STORAGE = '@nohack_public_key';
const SECRET_KEY_STORAGE = '@nohack_secret_key_fallback';

let publicKeyBytes: Uint8Array | null = null;
let secretKeyBytes: Uint8Array | null = null;
let initialized = false;

export class DecryptionError extends Error {
  constructor(message = 'Cannot decrypt — not addressed to you') {
    super(message);
    this.name = 'DecryptionError';
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ]);
}

async function loadSecretFromKeychain(): Promise<string | null> {
  try {
    const result = await withTimeout(
      Keychain.getGenericPassword({service: 'nohack-secret'}),
      3000,
    );
    if (result && typeof result === 'object' && 'password' in result) {
      return result.password;
    }
  } catch {}
  return null;
}

async function saveSecretToKeychain(secret: string): Promise<boolean> {
  try {
    const result = await withTimeout(
      Keychain.setGenericPassword('nohack', secret, {
        service: 'nohack-secret',
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
      3000,
    );
    return !!result;
  } catch {}
  return false;
}

// ── Key lifecycle ────────────────────────────────────────────────────────────

export async function initKeys(): Promise<void> {
  if (initialized) return;

  // Try loading existing keys
  const storedPub = await AsyncStorage.getItem(PUBLIC_KEY_STORAGE);

  if (storedPub) {
    // Try Keychain first, fall back to AsyncStorage
    let secretB64 = await loadSecretFromKeychain();
    if (!secretB64) {
      secretB64 = await AsyncStorage.getItem(SECRET_KEY_STORAGE);
    }

    if (secretB64) {
      publicKeyBytes = decodeBase64(storedPub);
      secretKeyBytes = decodeBase64(secretB64);
      initialized = true;
      return;
    }
  }

  // First run — generate new keypair
  const keyPair = nacl.box.keyPair();
  publicKeyBytes = keyPair.publicKey;
  secretKeyBytes = keyPair.secretKey;

  const pubB64 = encodeBase64(publicKeyBytes);
  const secB64 = encodeBase64(secretKeyBytes);

  // Store public key
  await AsyncStorage.setItem(PUBLIC_KEY_STORAGE, pubB64);

  // Store secret key — try Keychain, always save AsyncStorage fallback
  await saveSecretToKeychain(secB64);
  await AsyncStorage.setItem(SECRET_KEY_STORAGE, secB64);

  initialized = true;
}

export async function destroyKeys(): Promise<void> {
  // Zero out secret key memory before releasing reference
  if (secretKeyBytes) {
    secretKeyBytes.fill(0);
    secretKeyBytes = null;
  }
  publicKeyBytes = null;
  initialized = false;

  // Remove from Keychain
  try {
    await Keychain.resetGenericPassword({service: 'nohack-secret'});
  } catch {}

  // Remove from AsyncStorage
  await AsyncStorage.multiRemove([PUBLIC_KEY_STORAGE, SECRET_KEY_STORAGE]);
}

export function getPublicKey(): string {
  if (!publicKeyBytes) {
    throw new Error('Keys not initialized — call initKeys() first');
  }
  return encodeBase64(publicKeyBytes);
}

// ── Encryption ───────────────────────────────────────────────────────────────
// Produces: base64(ephemeralPubKey[32] + nonce[24] + ciphertext[...])

export function encrypt(plaintext: string, recipientPubKeyBase64: string): string {
  const recipientPub = decodeBase64(recipientPubKeyBase64);
  const message = decodeUTF8(plaintext);

  // Ephemeral keypair for forward secrecy
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);

  const ciphertext = nacl.box(message, nonce, recipientPub, ephemeral.secretKey);
  if (!ciphertext) {
    throw new Error('Encryption failed');
  }

  // Pack: ephemeralPub(32) + nonce(24) + ciphertext
  const packed = new Uint8Array(32 + 24 + ciphertext.length);
  packed.set(ephemeral.publicKey, 0);
  packed.set(nonce, 32);
  packed.set(ciphertext, 56);

  return encodeBase64(packed);
}

// ── Decryption ───────────────────────────────────────────────────────────────

export async function decrypt(encryptedBase64: string): Promise<string> {
  if (!secretKeyBytes) {
    // Try loading secret key
    let secretB64 = await loadSecretFromKeychain();
    if (!secretB64) {
      secretB64 = await AsyncStorage.getItem(SECRET_KEY_STORAGE);
    }
    if (!secretB64) throw new DecryptionError('No private key available');
    secretKeyBytes = decodeBase64(secretB64);
  }

  const packed = decodeBase64(encryptedBase64);
  if (packed.length < 56) {
    throw new DecryptionError('Invalid encrypted data');
  }

  const ephemeralPub = packed.slice(0, 32);
  const nonce = packed.slice(32, 56);
  const ciphertext = packed.slice(56);

  const plaintext = nacl.box.open(ciphertext, nonce, ephemeralPub, secretKeyBytes);
  if (!plaintext) {
    throw new DecryptionError();
  }

  return encodeUTF8(plaintext);
}
