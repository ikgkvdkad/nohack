import {NativeModules} from 'react-native';

const {NoHackNotification} = NativeModules;

export function notifyNewMessage(senderName: string, preview: string) {
  try {
    NoHackNotification?.show(senderName, preview || 'New message');
  } catch {}
}

export function notifyNewContact(contactName: string) {
  try {
    NoHackNotification?.show('New Contact', `${contactName} added`);
  } catch {}
}
