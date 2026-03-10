import React, {useState, useCallback, useEffect} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  StatusBar,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import QRCode from 'react-native-qrcode-svg';
import {Camera} from 'react-native-camera-kit';
import type {RootStackParamList} from '../types';
import {getPublicKey} from '../crypto/keys';
import {getRelayTelegramId} from '../store/relayIdentity';
import {addOrUpdateContact, getContact} from '../store/contactStore';
import {keyToName} from '../utils/deviceName';
import {getMyName} from '../store/myNameStore';
import {requestCameraPermission} from '../utils/permissions';

type Nav = NativeStackNavigationProp<RootStackParamList, 'AddContact'>;

type Mode = 'qr' | 'scan';

export default function AddContactScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const [mode, setMode] = useState<Mode>('qr');
  const [scanned, setScanned] = useState(false);
  const [cameraAllowed, setCameraAllowed] = useState(false);

  // Request camera permission when switching to scan mode
  useEffect(() => {
    if (mode === 'scan' && !cameraAllowed) {
      requestCameraPermission().then(ok => {
        setCameraAllowed(ok);
        if (!ok) Alert.alert('Permission denied', 'Camera permission is required to scan QR codes.');
      });
    }
  }, [mode, cameraAllowed]);

  const myPublicKey = getPublicKey();
  const relayTelegramId = getRelayTelegramId();

  const myCustomName = getMyName();

  // QR payload: compact JSON with our public key, name, and relay address
  const qrPayload = myPublicKey
    ? JSON.stringify({
        nohack: '3',
        type: 'introduction',
        senderPublicKey: myPublicKey,
        senderName: myCustomName || undefined,
        relayTelegramId: relayTelegramId || '',
      })
    : '';

  const handleScan = useCallback(async (event: any) => {
    if (scanned) return;
    const data = event.nativeEvent?.codeStringValue;
    if (!data) return;

    try {
      const parsed = JSON.parse(data);
      if (parsed.nohack !== '3' || parsed.type !== 'introduction' || !parsed.senderPublicKey) {
        Alert.alert('Invalid QR', 'This is not a NoHack contact QR code.');
        return;
      }

      // Don't add yourself
      if (parsed.senderPublicKey === myPublicKey) {
        Alert.alert('That\'s you', 'You scanned your own QR code.');
        return;
      }

      setScanned(true);

      const name = parsed.senderName || keyToName(parsed.senderPublicKey);
      const existing = getContact(parsed.senderPublicKey);
      await addOrUpdateContact(
        parsed.senderPublicKey,
        name,
        parsed.relayTelegramId || undefined,
      );

      Alert.alert(
        existing ? 'Contact Updated' : 'Contact Added',
        `${name}${parsed.relayTelegramId ? `\nRelay: ${parsed.relayTelegramId}` : ''}`,
        [{
          text: 'OK',
          onPress: () => navigation.goBack(),
        }],
      );
    } catch {
      Alert.alert('Invalid QR', 'Could not parse the QR code data.');
    }
  }, [scanned, myPublicKey, navigation]);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      <StatusBar backgroundColor="#1F2C34" barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {mode === 'qr' ? 'My QR Code' : 'Scan Contact'}
        </Text>
        <View style={styles.backBtn} />
      </View>

      {/* Mode toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, mode === 'qr' && styles.toggleActive]}
          onPress={() => { setMode('qr'); setScanned(false); }}>
          <Text style={[styles.toggleText, mode === 'qr' && styles.toggleTextActive]}>
            My QR
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, mode === 'scan' && styles.toggleActive]}
          onPress={() => { setMode('scan'); setScanned(false); }}>
          <Text style={[styles.toggleText, mode === 'scan' && styles.toggleTextActive]}>
            Scan
          </Text>
        </TouchableOpacity>
      </View>

      {mode === 'qr' ? (
        /* ── Show my QR ─────────────────────────────────────────────── */
        <View style={styles.qrContainer}>
          <View style={styles.qrCard}>
            {qrPayload ? (
              <QRCode
                value={qrPayload}
                size={220}
                backgroundColor="#FFFFFF"
                color="#000000"
              />
            ) : (
              <Text style={{color: '#8696A0', padding: 40}}>Loading keys...</Text>
            )}
          </View>
          <Text style={styles.qrName}>{myCustomName || keyToName(myPublicKey)}</Text>
          {relayTelegramId ? (
            <Text style={styles.qrRelay}>Relay: {relayTelegramId}</Text>
          ) : (
            <Text style={styles.qrWarning}>
              Connect USB to Relay first for full QR
            </Text>
          )}
          <Text style={styles.qrHint}>
            Show this QR to the other person.{'\n'}
            They scan it with their NoHack camera.
          </Text>
        </View>
      ) : (
        /* ── Scan their QR ──────────────────────────────────────────── */
        <View style={styles.scanContainer}>
          {!scanned && cameraAllowed && (
            <Camera
              scanBarcode
              onReadCode={handleScan}
              style={styles.camera}
            />
          )}
          {!scanned && !cameraAllowed && (
            <View style={styles.scannedOverlay}>
              <Text style={{color: '#8696A0', fontSize: 14}}>Requesting camera...</Text>
            </View>
          )}
          {scanned && (
            <View style={styles.scannedOverlay}>
              <Text style={styles.scannedText}>Contact saved!</Text>
            </View>
          )}
          <Text style={styles.scanHint}>
            Point camera at the other person's NoHack QR code
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0B141A'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
    backgroundColor: '#1F2C34',
    elevation: 3,
  },
  backBtn: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  backText: {color: '#E9EDEF', fontSize: 18},
  headerTitle: {color: '#E9EDEF', fontSize: 18, fontWeight: '600'},

  toggleRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: '#1F2C34',
    borderRadius: 10,
    padding: 3,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  toggleActive: {
    backgroundColor: '#2A3942',
  },
  toggleText: {color: '#8696A0', fontSize: 14, fontWeight: '500'},
  toggleTextActive: {color: '#E9EDEF'},

  // ── QR mode ────────────────────────────────────────────────────
  qrContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    elevation: 4,
  },
  qrName: {
    color: '#E9EDEF',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 20,
  },
  qrRelay: {
    color: '#8696A0',
    fontSize: 13,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  qrWarning: {
    color: '#FFC107',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  qrHint: {
    color: '#8696A0',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 20,
  },

  // ── Scan mode ──────────────────────────────────────────────────
  scanContainer: {
    flex: 1,
    margin: 20,
    borderRadius: 12,
    overflow: 'hidden',
  },
  camera: {
    flex: 1,
  },
  scanHint: {
    color: '#8696A0',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 14,
  },
  scannedOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  scannedText: {
    color: '#4CAF50',
    fontSize: 22,
    fontWeight: '700',
  },
});
