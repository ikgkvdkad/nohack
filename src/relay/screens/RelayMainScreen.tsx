import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  StatusBar,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RelayStackParamList} from '../../../RelayApp';
import RelayUsbService from '../services/RelayUsbService';
import RelayTelegramService from '../services/RelayTelegramService';
import {serializeForTransport} from '../../utils/nohack';
import type {LogEntry} from '../types';
import type {TransportResponse} from '../../types';
import {notifyNewMessage, notifyNewContact} from '../../services/NotificationService';
import {factoryResetRelay} from '../services/FactoryResetRelayService';
import KillSwitchSlider from '../../components/KillSwitchSlider';

type Nav = NativeStackNavigationProp<RelayStackParamList, 'RelayMain'>;

export default function RelayMainScreen() {
  const navigation = useNavigation<Nav>();
  const [status, setStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [telegramStatus, setTelegramStatus] = useState<'offline' | 'connecting' | 'online'>('offline');
  const [telegramId, setTelegramId] = useState('');
  const [deviceName, setDeviceName] = useState('NoHack');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  // Inbound queue: Telegram messages waiting for USB to reconnect
  const inboundQueue = useRef<{cmdType: string; payload: string}[]>([]);
  const usbConnectedRef = useRef(false);

  const addLog = useCallback((message: string, highlight?: boolean) => {
    const time = new Date().toLocaleTimeString('en-US', {hour12: false});
    setLogs(prev => [...prev.slice(-100), {time, message, highlight}]);
  }, []);

  useEffect(() => {
    // Subscribe to USB events
    const unsubStatus = RelayUsbService.onStatusChange(s => {
      setStatus(s);
      usbConnectedRef.current = s === 'connected';
      if (s === 'connected') {
        addLog('USB connected!', true);
        // Tell NoHack our Telegram identity so it can put it in QR codes
        const relayId = RelayTelegramService.getUserId();
        if (relayId) {
          RelayUsbService.send(serializeForTransport({cmd: 'identify', relayTelegramId: relayId}));
        }
        // Flush inbound queue
        if (inboundQueue.current.length > 0) {
          addLog(`Flushing ${inboundQueue.current.length} queued message(s) to NoHack...`, true);
          const queue = [...inboundQueue.current];
          inboundQueue.current = [];
          for (const item of queue) {
            RelayUsbService.send(serializeForTransport({cmd: item.cmdType, payload: item.payload}));
          }
        }
      } else if (s === 'disconnected') {
        addLog('USB disconnected');
      }
    });

    const unsubLog = RelayUsbService.onLog(msg => addLog(msg));

    const unsubName = RelayUsbService.onDeviceName(name => {
      const short = name.startsWith('NoHack ') ? name.substring(7) : name;
      if (short) setDeviceName(short);
    });

    // ── Telegram service ──────────────────────────────────────────────
    RelayTelegramService.init().then(() => {
      setTelegramId(RelayTelegramService.getUserId());
    });

    const unsubTelegramStatus = RelayTelegramService.onStatusChange(s => {
      setTelegramStatus(s);
    });

    const unsubTelegramLog = RelayTelegramService.onLog(msg => {
      const isHighlight = msg.includes('Telegram') || msg.includes('→');
      addLog(msg, isHighlight);
    });

    // Telegram → NoHack: forward incoming Telegram messages to NoHack via USB (or queue)
    const unsubTelegramData = RelayTelegramService.onData(nohackFile => {
      const cmdType = nohackFile.type === 'introduction' ? 'introduction' : 'decrypt';
      const payload = JSON.stringify(nohackFile);
      if (usbConnectedRef.current) {
        RelayUsbService.send(serializeForTransport({cmd: cmdType, payload}));
      } else {
        inboundQueue.current.push({cmdType, payload});
        addLog(`USB offline — queued for NoHack (${inboundQueue.current.length} pending)`);
      }
      // Notify on Relay phone only if NoHack is NOT connected (avoid double notifications)
      if (!usbConnectedRef.current) {
        if (nohackFile.type === 'introduction') {
          notifyNewContact(nohackFile.tag || 'Unknown');
        } else if (nohackFile.type !== 'ack') {
          notifyNewMessage('Incoming', `Message ${nohackFile.tag || ''} via Telegram`);
        }
      }
    });

    // USB → Telegram: forward outgoing NoHack messages to Telegram
    const unsubUsbForTelegram = RelayUsbService.onData((response: TransportResponse) => {
      if (response.cmd === 'factory_reset') {
        // NoHack told us to reset — do NOT notify NoHack back
        factoryResetRelay(false).then(() => {
          navigation.reset({index: 0, routes: [{name: 'TelegramSetup'}]});
        });
        return;
      }
      if ((response.cmd === 'encrypted' || response.cmd === 'introduction') && response.payload) {
        RelayTelegramService.sendNoHack(response.payload);
      }
    });

    // Start USB listener (auto-connects when cable is plugged in)
    RelayUsbService.start();

    return () => {
      unsubStatus();
      unsubLog();
      unsubName();
      unsubTelegramStatus();
      unsubTelegramLog();
      unsubTelegramData();
      unsubUsbForTelegram();
      RelayTelegramService.stop();
      RelayUsbService.disconnect();
    };
  }, [addLog]);

  const statusDotStyle = status === 'connected' ? styles.dotGreen : styles.dotYellow;
  const statusLabel = status === 'connected' ? 'Connected via USB' : 'Waiting for USB...';

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor="#16162A" barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.title}>
          <Text style={styles.titleNo}>NO</Text>HACK <Text style={styles.titleAccent}>RELAY</Text>
        </Text>
      </View>

      {/* Kill switch */}
      <KillSwitchSlider onActivate={() => {
        factoryResetRelay(true).then(() => {
          navigation.reset({index: 0, routes: [{name: 'TelegramSetup'}]});
        });
      }} />

      {/* Status card */}
      <View style={styles.statusSection}>
      <View style={styles.statusCard}>
        <View style={[styles.statusDot, statusDotStyle]} />
        <View style={styles.statusInfo}>
          <Text style={styles.statusName}>{deviceName}</Text>
          <Text style={styles.statusLabel}>{statusLabel}</Text>
        </View>
      </View>

      {/* Telegram status card */}
      {telegramId ? (
        <View style={styles.telegramCard}>
          <View style={[
            styles.statusDot,
            telegramStatus === 'online' ? styles.dotGreen
            : telegramStatus === 'connecting' ? styles.dotYellow
            : styles.dotRed,
          ]} />
          <View style={styles.statusInfo}>
            <Text style={styles.telegramLabel}>Telegram</Text>
            <Text style={styles.telegramIdText}>{telegramId}</Text>
          </View>
          <Text style={styles.telegramStatusText}>
            {telegramStatus === 'online' ? 'Online'
            : telegramStatus === 'connecting' ? 'Connecting...'
            : 'Offline'}
          </Text>
        </View>
      ) : null}
      </View>

      {/* Log area */}
      <View style={styles.logArea}>
        <Text style={styles.logLabel}>ACTIVITY</Text>
        <View style={styles.logBox}>
          <ScrollView
            ref={scrollRef}
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({animated: false})
            }>
            {logs.map((entry, i) => (
              <Text key={i} style={styles.logLine}>
                <Text style={styles.logTime}>[{entry.time}] </Text>
                <Text style={entry.highlight ? styles.logHighlight : styles.logText}>
                  {entry.message}
                </Text>
              </Text>
            ))}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1A',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#16162A',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#FFFFFF',
  },
  titleNo: {color: '#E53935'},
  titleAccent: {
    color: '#4CAF50',
  },
  statusSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  statusCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dotGreen: {
    backgroundColor: '#4CAF50',
  },
  dotYellow: {
    backgroundColor: '#FFC107',
  },
  dotRed: {
    backgroundColor: '#E53935',
  },
  statusInfo: {
    flex: 1,
  },
  statusName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  statusLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  telegramCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },
  telegramLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  telegramIdText: {
    fontSize: 11,
    color: '#666',
    fontFamily: 'monospace',
    marginTop: 1,
  },
  telegramStatusText: {
    fontSize: 12,
    color: '#666',
  },
  logArea: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  logLabel: {
    fontSize: 11,
    color: '#444',
    letterSpacing: 1,
    marginBottom: 8,
  },
  logBox: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 10,
    padding: 12,
  },
  logLine: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 20,
  },
  logTime: {
    color: '#444',
  },
  logText: {
    color: '#777',
  },
  logHighlight: {
    color: '#4CAF50',
    fontWeight: '500',
  },
});
