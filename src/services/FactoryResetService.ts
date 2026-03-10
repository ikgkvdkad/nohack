import AsyncStorage from '@react-native-async-storage/async-storage';
import {destroyKeys, initKeys} from '../crypto/keys';
import {clearAllContacts} from '../store/contactStore';
import {clearAllMessages} from '../store/chatState';
import UsbService from './UsbService';

/**
 * Factory reset for NoHack.
 * 1. If connected via USB, send factory_reset to Relay first.
 * 2. Destroy private key (zero memory + delete storage).
 * 3. Clear all data (contacts, messages, name, pin, setup).
 * 4. Generate fresh keypair.
 */
export async function factoryResetNoHack(notifyRelay: boolean): Promise<void> {
  // Step 1: tell the Relay to reset too (if connected)
  if (notifyRelay && UsbService.isConnected()) {
    try {
      await UsbService.sendResponse({cmd: 'factory_reset'});
      // Brief pause to let the command transmit
      await new Promise(r => setTimeout(r, 300));
    } catch {}
  }

  // Step 2: destroy the private key (zeros memory + deletes from storage)
  await destroyKeys();

  // Step 3: clear everything
  clearAllMessages();
  await clearAllContacts();
  await AsyncStorage.multiRemove([
    '@nohack_setup_complete',
    '@nohack_device_name',
    '@nohack_my_name',
    '@nohack_pin_hash',
  ]);

  // Step 4: stop USB
  UsbService.stop();

  // Step 5: generate fresh keypair
  await initKeys();
}
