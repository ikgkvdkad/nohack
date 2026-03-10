import {NativeModules} from 'react-native';

const {BluetoothDiscoverable} = NativeModules;

export function requestDiscoverable(
  durationSeconds: number = 300,
): Promise<boolean> {
  return BluetoothDiscoverable.requestDiscoverable(durationSeconds);
}
