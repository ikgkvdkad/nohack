import AsyncStorage from '@react-native-async-storage/async-storage';
import {keyToName} from '../utils/deviceName';

const NAME_KEY = '@nohack_my_name';

let cachedName: string | null = null;
type Listener = (name: string) => void;
const listeners = new Set<Listener>();

function notify(name: string) {
  listeners.forEach(fn => fn(name));
}

export function onNameChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadMyName(publicKey: string): Promise<string> {
  if (cachedName) return cachedName;
  const stored = await AsyncStorage.getItem(NAME_KEY);
  cachedName = stored || keyToName(publicKey);
  return cachedName;
}

export function getMyName(): string | null {
  return cachedName;
}

export async function setMyName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  cachedName = trimmed;
  await AsyncStorage.setItem(NAME_KEY, trimmed);
  notify(trimmed);
}

export function hasCustomName(): boolean {
  return cachedName !== null;
}
