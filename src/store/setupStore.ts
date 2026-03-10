import AsyncStorage from '@react-native-async-storage/async-storage';

const SETUP_KEY = '@nohack_setup_complete';
const DEVICE_NAME_KEY = '@nohack_device_name';

export async function isSetupComplete(): Promise<boolean> {
  return (await AsyncStorage.getItem(SETUP_KEY)) === 'true';
}

export async function markSetupComplete(): Promise<void> {
  await AsyncStorage.setItem(SETUP_KEY, 'true');
}

export async function clearSetup(): Promise<void> {
  await AsyncStorage.removeItem(SETUP_KEY);
}

export async function getDeviceName(): Promise<string | null> {
  return AsyncStorage.getItem(DEVICE_NAME_KEY);
}

export async function saveDeviceName(name: string): Promise<void> {
  await AsyncStorage.setItem(DEVICE_NAME_KEY, name);
}
