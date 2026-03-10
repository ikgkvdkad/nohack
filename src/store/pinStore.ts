import AsyncStorage from '@react-native-async-storage/async-storage';

const PIN_KEY = '@nohack_pin_hash';

function hashPin(pin: string): string {
  // Simple hash for now — replace with proper SHA-256 when crypto is implemented
  let hash = 0;
  for (let i = 0; i < pin.length; i++) {
    const char = pin.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return 'pin_' + Math.abs(hash).toString(36);
}

export async function hasPin(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(PIN_KEY);
  return stored !== null;
}

export async function setPin(pin: string): Promise<void> {
  await AsyncStorage.setItem(PIN_KEY, hashPin(pin));
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = await AsyncStorage.getItem(PIN_KEY);
  return stored === hashPin(pin);
}
