import React, {useState, useCallback, useEffect, useRef, useMemo} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  ScrollView,
  Dimensions,
  AppState,
  Modal,
  StatusBar,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {launchCamera} from 'react-native-image-picker';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import RNFS from 'react-native-fs';
import {RootStackParamList} from '../types';
import {createMessage, packInnerPayload} from '../utils/nohack';
import {encrypt, getPublicKey} from '../crypto/keys';
import {keyToName} from '../utils/deviceName';
import {getMyName} from '../store/myNameStore';
import {requestCameraPermission, requestMicrophonePermission} from '../utils/permissions';
import UsbService from '../services/UsbService';
import {getContact} from '../store/contactStore';
import {
  getMessages,
  addMessage,
  addToOutbox,
  markRead,
  subscribe,
  deleteQueuedMessage,
  getUnackedIncomingIds,
  type ChatMessage,
  type MessageStatus,
} from '../store/chatState';
import {setCurrentlyViewing, sendAck} from './ChatListScreen';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Chat'>;
type Route = RouteProp<RootStackParamList, 'Chat'>;

const audioRecorderPlayer = new AudioRecorderPlayer();
const screenWidth = Dimensions.get('window').width;
const IMG_MAX_WIDTH = screenWidth * 0.65;

function generateTag(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let tag = '';
  for (let i = 0; i < 3; i++) {
    tag += chars[Math.floor(Math.random() * chars.length)];
  }
  return tag;
}

function StatusTicks({status}: {status?: MessageStatus}) {
  if (!status || status === 'queued') {
    return <Text style={s.tickClock}>{'○'}</Text>;
  }
  if (status === 'sent') {
    return <Text style={s.tickGrey}>{'✓'}</Text>;
  }
  if (status === 'received') {
    return <Text style={s.tickGrey}>{'✓✓'}</Text>;
  }
  return <Text style={s.tickGreen}>{'✓✓'}</Text>;
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const {contactKey} = route.params;
  const flatListRef = useRef<FlatList>(null);

  const [displayName, setDisplayName] = useState(() => {
    const c = getContact(contactKey);
    return c?.name || keyToName(contactKey);
  });
  const contact = getContact(contactKey);

  const [messages, setMessages] = useState<ChatMessage[]>(() => getMessages(contactKey));
  const [text, setText] = useState('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingTag, setPendingTag] = useState(generateTag);
  const [connected, setConnected] = useState(UsbService.isConnected());

  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playProgress, setPlayProgress] = useState(0);
  const recordingPath = useRef<string | null>(null);
  const [viewerImage, setViewerImage] = useState<string | null>(null);

  const myName = useMemo(() => getMyName() || keyToName(getPublicKey()), []);

  useEffect(() => {
    setCurrentlyViewing(contactKey);
    markRead(contactKey);
    if (contact?.telegramId && AppState.currentState === 'active') {
      const ids = getUnackedIncomingIds(contactKey);
      if (ids.length > 0) sendAck('read', ids, contact.telegramId);
    }
    return () => setCurrentlyViewing(undefined);
  }, [contactKey]);

  useEffect(() => {
    return UsbService.onStatusChange(st => setConnected(st === 'connected'));
  }, []);

  // Send read ACK when app returns to foreground (screen turns on)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && contact?.telegramId) {
        markRead(contactKey);
        const ids = getUnackedIncomingIds(contactKey);
        if (ids.length > 0) sendAck('read', ids, contact.telegramId);
      }
    });
    return () => sub.remove();
  }, [contactKey, contact]);

  useEffect(() => {
    return subscribe(() => {
      setMessages([...getMessages(contactKey)]);
      // Refresh display name in case the sender updated their name
      const c = getContact(contactKey);
      if (c?.name) setDisplayName(c.name);
      // Only send read ACK when the screen is actually visible to the user
      if (AppState.currentState === 'active') {
        markRead(contactKey);
        if (c?.telegramId) {
          const ids = getUnackedIncomingIds(contactKey);
          if (ids.length > 0) sendAck('read', ids, c.telegramId);
        }
      }
    });
  }, [contactKey]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({animated: true}), 100);
    }
  }, [messages.length]);

  useEffect(() => {
    return () => {
      try { audioRecorderPlayer.stopRecorder(); } catch {}
      try { audioRecorderPlayer.stopPlayer(); } catch {}
      audioRecorderPlayer.removeRecordBackListener();
      audioRecorderPlayer.removePlayBackListener();
    };
  }, []);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleCamera = useCallback(async () => {
    try {
      const granted = await requestCameraPermission();
      if (!granted) { Alert.alert('Permission denied', 'Camera permission is required.'); return; }
      const result = await launchCamera({
        mediaType: 'photo',
        maxWidth: 1200,
        maxHeight: 1200,
        quality: 0.7,
        includeBase64: true,
      });
      if (result.assets && result.assets[0]?.base64) {
        setImageBase64(result.assets[0].base64);
      }
    } catch { Alert.alert('Error', 'Could not open camera.'); }
  }, []);

  const handleClearImage = useCallback(() => setImageBase64(null), []);

  // ── Voice ──────────────────────────────────────────────────────────────────

  const handleStartRecording = useCallback(async () => {
    try {
      const granted = await requestMicrophonePermission();
      if (!granted) { Alert.alert('Permission denied', 'Microphone permission is required.'); return; }
      const path = `${RNFS.CachesDirectoryPath}/nohack_voice_${Date.now()}.mp4`;
      recordingPath.current = path;
      setRecordSecs(0);
      audioRecorderPlayer.addRecordBackListener(e => setRecordSecs(Math.floor(e.currentPosition / 1000)));
      await audioRecorderPlayer.startRecorder(path);
      setRecording(true);
    } catch { Alert.alert('Error', 'Could not start recording.'); }
  }, []);

  const handleStopAndSendVoice = useCallback(async () => {
    if (!recording) return;
    try {
      await audioRecorderPlayer.stopRecorder();
      audioRecorderPlayer.removeRecordBackListener();
      setRecording(false);
      const path = recordingPath.current;
      if (!path) return;
      const base64 = await RNFS.readFile(path, 'base64');
      try { await RNFS.unlink(path); } catch {}
      setSending(true);
      const myKey = getPublicKey();
      const innerJson = packInnerPayload(myKey, 'voice', base64, getMyName() || undefined);
      const encrypted = encrypt(innerJson, contactKey);
      const file = createMessage(encrypted, contactKey, myKey);
      const tag = generateTag();
      (file as any).tag = tag;
      if (contact?.telegramId) (file as any).recipientTelegramId = contact.telegramId;
      const btPayload = {cmd: 'encrypted' as const, payload: JSON.stringify(file)};
      const sent = UsbService.isConnected() ? await UsbService.sendResponse(btPayload) : false;
      addMessage({id: file.id, contactKey, direction: 'out', contentType: 'voice', voice: base64, tag, timestamp: Date.now(), status: sent ? 'sent' : 'queued'});
      setPendingTag(generateTag());
      setSending(false);
      if (!sent) addToOutbox({id: file.id, contactKey, btPayload: JSON.stringify(btPayload)});
    } catch { setRecording(false); Alert.alert('Error', 'Could not send voice message.'); }
  }, [recording, contactKey, contact]);

  const handleCancelRecording = useCallback(async () => {
    if (!recording) return;
    try { await audioRecorderPlayer.stopRecorder(); audioRecorderPlayer.removeRecordBackListener(); } catch {}
    setRecording(false);
    if (recordingPath.current) try { await RNFS.unlink(recordingPath.current); } catch {}
  }, [recording]);

  const handlePlayVoice = useCallback(async (msgId: string, base64Audio: string) => {
    if (playingId === msgId) {
      try { await audioRecorderPlayer.stopPlayer(); } catch {}
      audioRecorderPlayer.removePlayBackListener();
      setPlayingId(null); setPlayProgress(0); return;
    }
    try { await audioRecorderPlayer.stopPlayer(); } catch {}
    audioRecorderPlayer.removePlayBackListener();
    const tempPath = `${RNFS.CachesDirectoryPath}/nohack_play_${msgId}.mp4`;
    try {
      await RNFS.writeFile(tempPath, base64Audio, 'base64');
      setPlayingId(msgId); setPlayProgress(0);
      audioRecorderPlayer.addPlayBackListener(e => {
        if (e.duration > 0) setPlayProgress(e.currentPosition / e.duration);
        if (e.currentPosition >= e.duration - 100) {
          audioRecorderPlayer.stopPlayer(); audioRecorderPlayer.removePlayBackListener();
          setPlayingId(null); setPlayProgress(0);
          try { RNFS.unlink(tempPath); } catch {}
        }
      });
      await audioRecorderPlayer.startPlayer(tempPath);
    } catch { setPlayingId(null); }
  }, [playingId]);

  // ── Send text/image ────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const hasText = text.trim().length > 0;
    const hasImage = !!imageBase64;
    if (!hasText && !hasImage) return;
    setSending(true);

    let contentType: 'text' | 'image' | 'mixed';
    let body: string;
    if (hasText && hasImage) { contentType = 'mixed'; body = JSON.stringify({text: text.trim(), image: imageBase64}); }
    else if (hasImage) { contentType = 'image'; body = imageBase64!; }
    else { contentType = 'text'; body = text.trim(); }

    const myKey = getPublicKey();
    const innerJson = packInnerPayload(myKey, contentType, body, getMyName() || undefined);
    const encrypted = encrypt(innerJson, contactKey);
    const file = createMessage(encrypted, contactKey, myKey);
    (file as any).tag = pendingTag;
    if (contact?.telegramId) (file as any).recipientTelegramId = contact.telegramId;

    const btPayload = {cmd: 'encrypted' as const, payload: JSON.stringify(file)};
    const sent = UsbService.isConnected() ? await UsbService.sendResponse(btPayload) : false;

    const sentText = text.trim();
    const sentTag = pendingTag;
    setText(''); setImageBase64(null); setSending(false);

    addMessage({id: file.id, contactKey, direction: 'out', contentType, text: hasText ? sentText : undefined, image: hasImage ? imageBase64! : undefined, tag: sentTag, timestamp: Date.now(), status: sent ? 'sent' : 'queued'});
    setPendingTag(generateTag());
    if (!sent) addToOutbox({id: file.id, contactKey, btPayload: JSON.stringify(btPayload)});
  }, [text, imageBase64, contactKey, pendingTag, contact]);

  const handleDeleteQueued = useCallback((msgId: string) => {
    Alert.alert('Delete unsent message?', 'This message has not been sent yet.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Delete', style: 'destructive', onPress: () => deleteQueuedMessage(msgId)},
    ]);
  }, []);

  const hasContent = imageBase64 || text.trim();

  // ── Render ─────────────────────────────────────────────────────────────────

  const VoiceBubble = ({msgId, base64Audio}: {msgId: string; base64Audio: string}) => {
    const isPlaying = playingId === msgId;
    return (
      <TouchableOpacity style={s.voiceRow} onPress={() => handlePlayVoice(msgId, base64Audio)} activeOpacity={0.7}>
        <Text style={s.voicePlayBtn}>{isPlaying ? '||' : '▶'}</Text>
        <View style={s.voiceBarBg}>
          <View style={[s.voiceBarFill, {width: isPlaying ? `${Math.round(playProgress * 100)}%` : '0%'}]} />
        </View>
      </TouchableOpacity>
    );
  };

  const MediaThumb = ({base64, isVideo}: {base64: string; isVideo?: boolean}) => (
    <TouchableOpacity
      style={s.mediaThumbnail}
      activeOpacity={0.8}
      onPress={() => !isVideo && setViewerImage(base64)}>
      <Image
        source={{uri: `data:image/jpeg;base64,${base64}`}}
        style={s.mediaImg}
        resizeMode="cover"
      />
      {isVideo && (
        <View style={s.videoOverlay}>
          <Text style={s.videoPlayIcon}>▶</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderMessage = ({item}: {item: ChatMessage}) => {
    const isOut = item.direction === 'out';
    const isQueued = item.status === 'queued';
    const time = new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

    const hasMedia = !!(item.image || item.video);
    const bubbleStyle = isOut
      ? [s.bubble, s.bubbleOut, isQueued && s.bubbleQueued]
      : [s.bubble, s.bubbleIn];

    return (
      <View style={isOut ? s.rowOut : s.rowIn}>
        <TouchableOpacity
          style={bubbleStyle}
          onLongPress={isQueued ? () => handleDeleteQueued(item.id) : undefined}
          delayLongPress={500}
          activeOpacity={isQueued ? 0.6 : 1}
          disabled={!isQueued}>

          {!isOut && <Text style={s.senderName}>{displayName}</Text>}

          {item.isIntroduction && <Text style={s.introLabel}>Contact card received</Text>}

          {item.voice && <VoiceBubble msgId={item.id} base64Audio={item.voice} />}

          {item.image && <MediaThumb base64={item.image} />}
          {item.video && <MediaThumb base64={item.video} isVideo />}

          {item.text && (
            <Text style={isOut ? s.textOut : s.textIn}>
              {item.text}
              <Text style={s.timeSpacer}>{'     ' + (isOut ? '      ' : '')}</Text>
            </Text>
          )}

          <View style={item.text ? s.metaFloat : s.meta}>
            <Text style={isOut ? s.timeOut : s.timeIn}>{time}</Text>
            {isOut && <StatusTicks status={item.status} />}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[s.container, {paddingTop: insets.top}]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={handleBack} style={s.backBtn}>
          <Text style={s.backArrow}>{'←'}</Text>
        </TouchableOpacity>
        <View style={s.headerAvatar}>
          <Text style={s.headerAvatarText}>{displayName[0]}</Text>
        </View>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>{displayName}</Text>
          <View style={s.headerSubRow}>
            {contact?.telegramId ? (
              <Text style={s.headerTelegram} numberOfLines={1}>{'✈ '}{contact.telegramId}</Text>
            ) : null}
            <Text style={s.headerSub}>{connected ? 'online' : 'offline'}</Text>
          </View>
        </View>
        <View style={[s.connDot, {backgroundColor: connected ? '#4CAF50' : '#FFC107'}]} />
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={m => m.id}
        renderItem={renderMessage}
        style={s.messageList}
        contentContainerStyle={s.messageListContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({animated: false})}
      />

      {/* Recording bar */}
      {recording && (
        <View style={s.recordingBar}>
          <View style={s.recordDot} />
          <Text style={s.recordingText}>
            {Math.floor(recordSecs / 60)}:{(recordSecs % 60).toString().padStart(2, '0')}
          </Text>
          <TouchableOpacity onPress={handleCancelRecording} style={s.cancelRecordBtn}>
            <Text style={s.cancelRecordText}>X</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleStopAndSendVoice} style={s.sendBtn}>
            <View style={s.sendArrow}>
              <View style={s.sendArrowLine} />
              <View style={s.sendArrowHead} />
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Image preview */}
      {imageBase64 && !recording && (
        <View style={s.imagePreviewBar}>
          <Image source={{uri: `data:image/jpeg;base64,${imageBase64}`}} style={s.previewThumb} resizeMode="cover" />
          <TouchableOpacity onPress={handleClearImage}>
            <Text style={s.clearImageText}>Remove</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Compose bar */}
      {!recording && (
        <View style={[s.composeBar, {paddingBottom: insets.bottom + 6}]}>
          <TouchableOpacity style={s.cameraBtn} onPress={handleCamera}>
            <View style={s.cameraIconWrap}>
              <View style={s.cameraBody} />
              <View style={s.cameraLens} />
              <View style={s.cameraFlash} />
            </View>
          </TouchableOpacity>
          <View style={s.inputWrap}>
            <Text style={s.tagHint}>{myName} — {pendingTag}</Text>
            <TextInput
              style={s.textInput}
              multiline
              placeholder="Message"
              placeholderTextColor="#8696A0"
              value={text}
              onChangeText={setText}
            />
          </View>
          {hasContent ? (
            <TouchableOpacity style={[s.sendBtn, sending && s.sendBtnDisabled]} onPress={handleSend} disabled={sending}>
              <View style={s.sendArrow}>
                <View style={s.sendArrowLine} />
                <View style={s.sendArrowHead} />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={s.micBtn} onPress={handleStartRecording}>
              <View style={s.micIconWrap}>
                <View style={s.micHead} />
                <View style={s.micStem} />
                <View style={s.micBase} />
              </View>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Full-size image viewer with pinch-to-zoom */}
      <Modal visible={!!viewerImage} transparent animationType="fade" onRequestClose={() => setViewerImage(null)}>
        <StatusBar backgroundColor="#000000" barStyle="light-content" />
        <View style={s.viewerContainer}>
          <TouchableOpacity style={s.viewerClose} onPress={() => setViewerImage(null)}>
            <Text style={s.viewerCloseText}>✕</Text>
          </TouchableOpacity>
          {viewerImage && (
            <ScrollView
              style={s.viewerScroll}
              contentContainerStyle={s.viewerScrollContent}
              maximumZoomScale={5}
              minimumZoomScale={1}
              bouncesZoom
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}>
              <Image
                source={{uri: `data:image/jpeg;base64,${viewerImage}`}}
                style={s.viewerImage}
                resizeMode="contain"
              />
            </ScrollView>
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0B141A'},
  // ── Header ─────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 8,
    backgroundColor: '#1F2C34',
    elevation: 3,
  },
  backBtn: {paddingHorizontal: 4, paddingVertical: 8, paddingRight: 8},
  backArrow: {color: '#E9EDEF', fontSize: 18},
  headerAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(76,175,80,0.2)',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
  },
  headerAvatarText: {color: '#4CAF50', fontSize: 18, fontWeight: '700'},
  headerCenter: {flex: 1},
  headerTitle: {color: '#E9EDEF', fontSize: 16, fontWeight: '600'},
  headerSubRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1},
  headerTelegram: {color: '#2AABEE', fontSize: 11},
  headerSub: {color: '#8696A0', fontSize: 12},
  connDot: {width: 8, height: 8, borderRadius: 4, marginRight: 12},
  // ── Messages ───────────────────────────────────────
  messageList: {flex: 1},
  messageListContent: {paddingHorizontal: 8, paddingVertical: 6, flexGrow: 1, justifyContent: 'flex-end'},
  rowIn: {flexDirection: 'row', justifyContent: 'flex-start', marginBottom: 2},
  rowOut: {flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 2},
  bubble: {
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingTop: 6,
    paddingBottom: 5,
    maxWidth: '80%',
    minWidth: 80,
  },
  bubbleIn: {
    backgroundColor: '#1F2C34',
    borderTopLeftRadius: 0,
  },
  bubbleOut: {
    backgroundColor: '#005C4B',
    borderTopRightRadius: 0,
  },
  bubbleQueued: {opacity: 0.5},
  senderName: {color: '#4CAF50', fontSize: 12.5, fontWeight: '600', marginBottom: 2},
  introLabel: {color: '#8696A0', fontSize: 13},
  textIn: {color: '#E9EDEF', fontSize: 14.5, lineHeight: 19},
  textOut: {color: '#E9EDEF', fontSize: 14.5, lineHeight: 19},
  // ── Meta (time + ticks) ────────────────────────────
  timeSpacer: {fontSize: 10, color: 'transparent'},
  meta: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 3,
    marginTop: 1,
  },
  metaFloat: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 3,
    marginTop: -14,
    marginBottom: -2,
  },
  timeIn: {color: '#8696A099', fontSize: 11},
  timeOut: {color: '#FFFFFF80', fontSize: 11},
  tickClock: {color: '#FFFFFF60', fontSize: 11},
  tickGrey: {color: '#FFFFFF80', fontSize: 12},
  tickGreen: {color: '#53BDEB', fontSize: 12},
  // ── Media thumbnails ───────────────────────────────
  mediaThumbnail: {
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 4,
    marginTop: 2,
    maxWidth: IMG_MAX_WIDTH,
  },
  mediaImg: {
    width: IMG_MAX_WIDTH,
    height: IMG_MAX_WIDTH * 0.75,
    borderRadius: 6,
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  videoPlayIcon: {color: '#FFFFFF', fontSize: 36},
  // ── Voice ──────────────────────────────────────────
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    minWidth: 150,
  },
  voicePlayBtn: {color: '#8696A0', fontSize: 16, fontWeight: '700', width: 20, textAlign: 'center'},
  voiceBarBg: {
    flex: 1, height: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 1.5, overflow: 'hidden',
  },
  voiceBarFill: {height: '100%', backgroundColor: '#4CAF50', borderRadius: 1.5},
  // ── Recording ──────────────────────────────────────
  recordingBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#1F2C34',
  },
  recordDot: {width: 10, height: 10, borderRadius: 5, backgroundColor: '#E53935'},
  recordingText: {flex: 1, color: '#E9EDEF', fontSize: 16, fontFamily: 'monospace'},
  cancelRecordBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(229,57,53,0.15)',
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  cancelRecordText: {color: '#E53935', fontSize: 15, fontWeight: '700'},
  // ── Compose ────────────────────────────────────────
  composeBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6,
    paddingHorizontal: 6, paddingTop: 6,
    backgroundColor: '#1F2C34',
  },
  // ── Camera icon (CSS-drawn) ──────────────────────
  cameraBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  cameraIconWrap: {
    width: 22, height: 17,
    position: 'relative' as const,
  },
  cameraBody: {
    position: 'absolute' as const,
    bottom: 0, left: 0, right: 0,
    height: 14, borderRadius: 3,
    backgroundColor: '#8696A0',
  },
  cameraLens: {
    position: 'absolute' as const,
    bottom: 3, left: 7, width: 8, height: 8,
    borderRadius: 4, backgroundColor: '#1F2C34',
    borderWidth: 1.5, borderColor: '#8696A0',
  },
  cameraFlash: {
    position: 'absolute' as const,
    top: 0, left: 6, width: 10, height: 5,
    borderTopLeftRadius: 2, borderTopRightRadius: 2,
    backgroundColor: '#8696A0',
  },
  inputWrap: {
    flex: 1,
    backgroundColor: '#2A3942',
    borderRadius: 21,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minHeight: 42,
  },
  tagHint: {
    color: '#4CAF50',
    fontSize: 10,
    fontWeight: '600',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  textInput: {color: '#E9EDEF', fontSize: 16, lineHeight: 20, maxHeight: 100, padding: 0},
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#00A884',
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  sendBtnDisabled: {opacity: 0.4},
  // ── Send arrow icon (CSS-drawn) ─────────────────
  sendArrow: {
    width: 20, height: 20,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    transform: [{rotate: '-30deg'}],
  },
  sendArrowLine: {
    width: 16, height: 2.5,
    backgroundColor: '#FFFFFF',
    borderRadius: 1.5,
  },
  sendArrowHead: {
    position: 'absolute' as const,
    right: 0, top: 3,
    width: 0, height: 0,
    borderLeftWidth: 8, borderLeftColor: '#FFFFFF',
    borderTopWidth: 5, borderTopColor: 'transparent',
    borderBottomWidth: 5, borderBottomColor: 'transparent',
  },
  // ── Mic icon (CSS-drawn) ────────────────────────
  micBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  micIconWrap: {
    width: 16, height: 24,
    alignItems: 'center' as const,
  },
  micHead: {
    width: 10, height: 14,
    borderRadius: 5,
    backgroundColor: '#8696A0',
  },
  micStem: {
    width: 2, height: 4,
    backgroundColor: '#8696A0',
  },
  micBase: {
    width: 12, height: 2,
    borderRadius: 1,
    backgroundColor: '#8696A0',
  },
  // ── Image preview ──────────────────────────────────
  imagePreviewBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#1F2C34',
  },
  previewThumb: {width: 48, height: 48, borderRadius: 6},
  clearImageText: {color: '#E53935', fontSize: 13},
  // ── Full-size image viewer ─────────────────────────
  viewerContainer: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerScroll: {
    flex: 1,
  },
  viewerScrollContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImage: {
    width: screenWidth,
    height: Dimensions.get('window').height,
  },
  viewerClose: {
    position: 'absolute',
    top: 44,
    right: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerCloseText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '600',
  },
});
