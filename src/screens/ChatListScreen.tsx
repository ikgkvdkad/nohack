import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RootStackParamList} from '../types';
import UsbService from '../services/UsbService';
import {getPublicKey, decrypt, DecryptionError, initKeys} from '../crypto/keys';
import {createIntroduction, createAck, parseNoHackFile, unpackInnerPayload} from '../utils/nohack';
import {clearSetup} from '../store/setupStore';
import {setRelayTelegramId, clearRelayTelegramId} from '../store/relayIdentity';
import {keyToName} from '../utils/deviceName';
import {loadMyName, getMyName, setMyName, onNameChange} from '../store/myNameStore';
import {
  loadContacts,
  getContacts,
  getContact,
  addOrUpdateContact,
  removeContact,
  type Contact,
} from '../store/contactStore';
import {
  addIncomingMessage,
  addToOutbox,
  clearOutboxEntry,
  deleteChat,
  getOutbox,
  getLastMessage,
  getUnreadCount,
  loadMessages,
  subscribe,
  updateMessageStatus,
  type ChatMessage,
} from '../store/chatState';
import {notifyNewMessage, notifyNewContact} from '../services/NotificationService';
import {factoryResetNoHack} from '../services/FactoryResetService';
import KillSwitchSlider from '../components/KillSwitchSlider';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ChatList'>;

// Track which chat is currently open so we can route unreads correctly
let currentlyViewingContact: string | undefined;

export function setCurrentlyViewing(contactKey: string | undefined) {
  currentlyViewingContact = contactKey;
}

// Pending acks to send (queued when offline)
let pendingAcks: {ackType: 'received' | 'read'; ackIds: string[]; recipientTelegramId: string}[] = [];

// Send an ack via USB, or queue it for later
export function sendAck(ackType: 'received' | 'read', ackIds: string[], recipientTelegramId: string) {
  if (ackIds.length === 0) return;
  const ack = createAck(ackType, ackIds);
  (ack as any).recipientTelegramId = recipientTelegramId;
  UsbService.sendResponse({
    cmd: 'encrypted',
    payload: JSON.stringify(ack),
  }).then(ok => {
    if (!ok) {
      pendingAcks.push({ackType, ackIds, recipientTelegramId});
    }
  });
}

// Flush pending acks + outbox when USB reconnects
async function flushOnConnect() {
  // Flush pending acks
  const acks = [...pendingAcks];
  pendingAcks = [];
  for (const a of acks) {
    const ack = createAck(a.ackType, a.ackIds);
    (ack as any).recipientTelegramId = a.recipientTelegramId;
    await UsbService.sendResponse({
      cmd: 'encrypted',
      payload: JSON.stringify(ack),
    });
  }

  // Flush outbox
  const entries = getOutbox();
  for (const entry of entries) {
    const ok = await UsbService.sendResponse(JSON.parse(entry.btPayload));
    if (ok) {
      clearOutboxEntry(entry.id);
      updateMessageStatus([entry.id], 'sent');
    }
  }
}

export default function ChatListScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const [connected, setConnected] = useState(UsbService.isConnected());
  const [myName, setMyNameState] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [editNameText, setEditNameText] = useState('');
  const [contactList, setContactList] = useState<Contact[]>([]);
  const [sentTag, setSentTag] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Load contacts + start USB listener
  useEffect(() => {
    (async () => {
      await initKeys();
      const name = await loadMyName(getPublicKey());
      setMyNameState(name);
      await loadContacts();
      await loadMessages();
      setContactList([...getContacts()]);
      UsbService.start();
    })();
    return onNameChange(name => setMyNameState(name));
  }, []);

  // Subscribe to chat state changes
  useEffect(() => {
    return subscribe(() => setTick(t => t + 1));
  }, []);

  // Refresh contact list when screen gains focus
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      setCurrentlyViewing(undefined);
      setContactList([...getContacts()]);
    });
    return unsub;
  }, [navigation]);

  // USB status listener + flush on reconnect
  useEffect(() => {
    const unsub = UsbService.onStatusChange(s => {
      setConnected(s === 'connected');
      if (s === 'connected') {
        flushOnConnect();
      } else {
        clearRelayTelegramId();
      }
    });
    return unsub;
  }, []);

  // USB command listener — the central message router
  useEffect(() => {
    const unsub = UsbService.onCommand(async cmd => {
      if ((cmd.cmd === 'decrypt' || cmd.cmd === 'introduction') && cmd.payload) {
        const file = parseNoHackFile(cmd.payload);
        if (!file) return;

        // ── Ack message ──────────────────────────────────────────────
        if (file.type === 'ack' && file.ackType && file.ackIds) {
          updateMessageStatus(file.ackIds, file.ackType === 'read' ? 'read' : 'received');
          return;
        }

        // ── Introduction ─────────────────────────────────────────────
        if (file.type === 'introduction' && file.senderPublicKey) {
          // Skip our own introduction (echoed back from Saved Messages)
          if (file.senderPublicKey === getPublicKey()) return;
          // Verify this is a genuinely new contact vs. existing
          const existingContact = getContact(file.senderPublicKey);
          const name = file.senderName || keyToName(file.senderPublicKey);
          await addOrUpdateContact(file.senderPublicKey, name, file.relayTelegramId);
          setContactList([...getContacts()]);

          const msg: ChatMessage = {
            id: file.id,
            contactKey: file.senderPublicKey,
            direction: 'in',
            contentType: 'text',
            text: existingContact
              ? 'Contact card updated'
              : `New contact: ${name}\nVerify this person out-of-band before sharing secrets.`,
            tag: file.tag,
            timestamp: Date.now(),
            isIntroduction: true,
          };
          addIncomingMessage(msg, currentlyViewingContact);
          if (!existingContact) {
            notifyNewContact(name);
          }
          return;
        }

        // ── Encrypted message ────────────────────────────────────────
        if (!file.payload) return;
        try {
          const innerJson = await decrypt(file.payload);
          const inner = unpackInnerPayload(innerJson);
          const name = inner.senderName || keyToName(inner.senderPublicKey);
          await addOrUpdateContact(inner.senderPublicKey, name, file.relayTelegramId);
          setContactList([...getContacts()]);

          const msg: ChatMessage = {
            id: file.id,
            contactKey: inner.senderPublicKey,
            direction: 'in',
            contentType: inner.contentType,
            tag: file.tag,
            timestamp: Date.now(),
          };

          if (inner.contentType === 'text') {
            msg.text = inner.body;
          } else if (inner.contentType === 'image') {
            msg.image = inner.body;
          } else if (inner.contentType === 'voice') {
            msg.voice = inner.body;
          } else if (inner.contentType === 'video') {
            msg.video = inner.body;
          } else if (inner.contentType === 'mixed') {
            try {
              const mixed = JSON.parse(inner.body);
              msg.text = mixed.text;
              msg.image = mixed.image;
            } catch {}
          }

          addIncomingMessage(msg, currentlyViewingContact);

          // Notify if not currently viewing this chat
          if (inner.senderPublicKey !== currentlyViewingContact) {
            let preview = '';
            if (inner.contentType === 'text') preview = inner.body;
            else if (inner.contentType === 'image') preview = '[Photo]';
            else if (inner.contentType === 'voice') preview = '[Voice message]';
            else if (inner.contentType === 'video') preview = '[Video]';
            else if (inner.contentType === 'mixed') preview = msg.text || '[Photo]';
            notifyNewMessage(name, preview);
          }

          // Send received ack back to sender
          const contact = getContact(inner.senderPublicKey);
          if (contact?.telegramId) {
            sendAck('received', [file.id], contact.telegramId);
          }
        } catch (err) {
          if (err instanceof DecryptionError) {
            // silently ignore — not for us
          }
        }
      } else if (cmd.cmd === 'identify' && cmd.relayTelegramId) {
        setRelayTelegramId(cmd.relayTelegramId);
        console.log('[ChatList] Relay identified as', cmd.relayTelegramId);
      } else if (cmd.cmd === 'factory_reset') {
        // Relay told us to reset — do NOT notify relay back (it already reset itself)
        factoryResetNoHack(false).then(() => {
          navigation.reset({index: 0, routes: [{name: 'Setup'}]});
        });
      } else if (cmd.cmd === 'ping') {
        const name = getMyName() || keyToName(getPublicKey());
        UsbService.sendResponse({cmd: 'ack', deviceName: name});
      }
    });
    return unsub;
  }, []);

  const handleStartEditName = useCallback(() => {
    setEditNameText(myName);
    setEditingName(true);
  }, [myName]);

  const handleSaveName = useCallback(async () => {
    const trimmed = editNameText.trim();
    if (trimmed && trimmed !== myName) {
      await setMyName(trimmed);
    }
    setEditingName(false);
  }, [editNameText, myName]);

  const handleSendIntro = useCallback(async () => {
    const name = getMyName() || myName;
    const intro = createIntroduction(getPublicKey(), name);
    (intro as any).recipientTelegramId = 'me';
    const sent = await UsbService.sendResponse({
      cmd: 'introduction',
      payload: JSON.stringify(intro),
    });
    if (sent) {
      setSentTag(intro.tag);
      setTimeout(() => setSentTag(null), 5000);
    } else {
      Alert.alert('Not connected', 'Plug in your relay via USB.');
    }
  }, [myName]);

  const handleResetPairing = useCallback(() => {
    Alert.alert(
      'Reset pairing',
      'This will unpair your NoHack and return to the setup screen. Continue?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            UsbService.stop();
            await clearSetup();
            navigation.reset({index: 0, routes: [{name: 'Setup'}]});
          },
        },
      ],
    );
  }, [navigation]);

  const handleOpenChat = useCallback(
    (contact: Contact) => {
      navigation.navigate('Chat', {contactKey: contact.publicKey});
    },
    [navigation],
  );

  const handleDeleteChat = useCallback(
    (contact: Contact) => {
      Alert.alert(
        'Delete chat',
        `Delete all messages with ${contact.name}? This also removes the contact.`,
        [
          {text: 'Cancel', style: 'cancel'},
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              deleteChat(contact.publicKey);
              await removeContact(contact.publicKey);
              setContactList([...getContacts()]);
            },
          },
        ],
      );
    },
    [],
  );

  const statusColor = connected ? '#4CAF50' : '#FFC107';
  const statusText = connected ? 'Connected' : 'Waiting...';

  const renderContact = ({item}: {item: Contact}) => {
    const last = getLastMessage(item.publicKey);
    const unread = getUnreadCount(item.publicKey);
    let preview = '';
    if (last) {
      if (last.isIntroduction) preview = 'Contact card received';
      else if (last.voice) preview = last.direction === 'out' ? 'You: [voice]' : '[voice]';
      else if (last.video) preview = last.direction === 'out' ? 'You: [video]' : '[video]';
      else if (last.text) preview = last.direction === 'out' ? `You: ${last.text}` : last.text;
      else if (last.image) preview = last.direction === 'out' ? 'You: [image]' : '[image]';
    }

    return (
      <TouchableOpacity style={styles.contactRow} onPress={() => handleOpenChat(item)} onLongPress={() => handleDeleteChat(item)} delayLongPress={600}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.name[0]}</Text>
        </View>
        <View style={styles.contactInfo}>
          <View style={styles.contactTopRow}>
            <View style={styles.nameRow}>
              <Text style={styles.contactName} numberOfLines={1}>{item.name}</Text>
              {item.telegramId ? (
                <Text style={styles.telegramTag} numberOfLines={1}>{'✈ '}{item.telegramId}</Text>
              ) : null}
            </View>
            {last && (
              <Text style={styles.contactTime}>
                {new Date(last.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
              </Text>
            )}
          </View>
          <View style={styles.contactBottomRow}>
            <Text style={styles.contactPreview} numberOfLines={1}>
              {preview || 'No messages yet'}
            </Text>
            {unread > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unread}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onLongPress={handleResetPairing} delayLongPress={1500}>
          <Text style={styles.headerTitle}>
            <Text style={styles.headerNo}>NO</Text>HACK
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.nameEditBtn} onPress={handleStartEditName}>
          {editingName ? (
            <TextInput
              style={styles.nameInput}
              value={editNameText}
              onChangeText={setEditNameText}
              onBlur={handleSaveName}
              onSubmitEditing={handleSaveName}
              autoFocus
              selectTextOnFocus
              maxLength={24}
              returnKeyType="done"
            />
          ) : (
            <View style={styles.nameDisplay}>
              <Text style={styles.headerName} numberOfLines={1}>{myName}</Text>
              <Text style={styles.editIcon}>{'✎'}</Text>
            </View>
          )}
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <View style={[styles.statusDot, {backgroundColor: statusColor}]} />
          <Text style={styles.statusLabel}>{statusText}</Text>
        </View>
      </View>

      {/* Kill switch */}
      <KillSwitchSlider onActivate={() => {
        factoryResetNoHack(true).then(() => {
          navigation.reset({index: 0, routes: [{name: 'Setup'}]});
        });
      }} />

      {/* Chat list */}
      {contactList.length > 0 ? (
        <FlatList
          data={contactList}
          keyExtractor={c => c.publicKey}
          renderItem={renderContact}
          style={styles.list}
        />
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptyHint}>
            Share your contact card to start messaging
          </Text>
        </View>
      )}

      {/* Sent tag confirmation */}
      {sentTag && (
        <View style={styles.sentBanner}>
          <Text style={styles.sentCheck}>sent</Text>
          <Text style={styles.sentCode}>{sentTag}</Text>
          <Text style={styles.sentLabel}>check Saved Messages</Text>
        </View>
      )}

      {/* Bottom action bar */}
      <View style={[styles.bottomBar, {paddingBottom: insets.bottom + 8}]}>
        <TouchableOpacity style={styles.introBtn} onPress={handleSendIntro}>
          <Text style={styles.introBtnText}>Share contact card</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.qrBtn}
          onPress={() => navigation.navigate('AddContact')}>
          <Text style={styles.qrBtnText}>QR</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0B141A'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#1F2C34',
    elevation: 3,
  },
  headerTitle: {color: '#E9EDEF', fontSize: 18, fontWeight: '600', letterSpacing: 2},
  headerNo: {color: '#E53935'},
  nameEditBtn: {flex: 1, marginLeft: 8, marginRight: 8},
  nameDisplay: {flexDirection: 'row', alignItems: 'center', gap: 4},
  headerName: {fontSize: 14, fontWeight: '500', color: '#E9EDEF', flexShrink: 1},
  editIcon: {color: '#8696A0', fontSize: 13},
  nameInput: {
    fontSize: 14,
    fontWeight: '500',
    color: '#E9EDEF',
    borderBottomWidth: 1,
    borderBottomColor: '#4CAF50',
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  headerRight: {flexDirection: 'row', alignItems: 'center', gap: 6},
  statusDot: {width: 8, height: 8, borderRadius: 4},
  statusLabel: {color: '#8696A0', fontSize: 12},
  list: {flex: 1},
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(76,175,80,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {color: '#4CAF50', fontSize: 21, fontWeight: '700'},
  contactInfo: {flex: 1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#222D34', paddingBottom: 12},
  contactTopRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  nameRow: {flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8, gap: 6},
  contactName: {color: '#E9EDEF', fontSize: 16, fontWeight: '500', flexShrink: 1},
  telegramTag: {color: '#2AABEE', fontSize: 12, flexShrink: 0},
  contactTime: {color: '#8696A0', fontSize: 12},
  contactBottomRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 3},
  contactPreview: {color: '#8696A0', fontSize: 14, flex: 1, marginRight: 8},
  badge: {
    backgroundColor: '#00A884',
    borderRadius: 11,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {color: '#FFFFFF', fontSize: 12, fontWeight: '700'},
  emptyState: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40},
  emptyTitle: {color: '#E9EDEF', fontSize: 18, fontWeight: '600', marginBottom: 8},
  emptyHint: {color: '#8696A0', fontSize: 14, textAlign: 'center'},
  sentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,168,132,0.1)',
  },
  sentCheck: {color: '#00A884', fontSize: 14, fontWeight: '700'},
  sentCode: {
    color: '#E9EDEF',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 3,
  },
  sentLabel: {color: '#8696A0', fontSize: 12},
  bottomBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#1F2C34',
    gap: 10,
  },
  introBtn: {
    flex: 1,
    backgroundColor: '#2A3942',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  introBtnText: {color: '#E9EDEF', fontSize: 14, fontWeight: '500'},
  qrBtn: {
    backgroundColor: '#00A884',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrBtnText: {color: '#FFFFFF', fontSize: 14, fontWeight: '700'},
});
