import AsyncStorage from '@react-native-async-storage/async-storage';
import RelayTelegramService from './RelayTelegramService';
import RelayUsbService from './RelayUsbService';
import {clearTelegramCredentials} from '../store/relayStore';

/**
 * Factory reset for Relay.
 * 1. If connected, send factory_reset to NoHack first.
 * 2. Disconnect Telegram session.
 * 3. Clear all stored data.
 */
export async function factoryResetRelay(notifyNoHack: boolean): Promise<void> {
  // Step 1: tell NoHack to reset too (if connected)
  if (notifyNoHack && RelayUsbService.isConnected()) {
    try {
      const {serializeForTransport} = require('../../utils/nohack');
      RelayUsbService.send(serializeForTransport({cmd: 'factory_reset'}));
      await new Promise(r => setTimeout(r, 300));
    } catch {}
  }

  // Step 2: disconnect Telegram
  RelayTelegramService.stop();

  // Step 3: clear Telegram credentials and all stored data
  await clearTelegramCredentials();
  await AsyncStorage.multiRemove([
    '@relay_selected_device',
    '@relay_telegram_credentials',
    '@relay_telegram_contacts',
  ]);

  // Step 4: stop USB
  RelayUsbService.disconnect();
}
