import React, {useState, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RelayStackParamList} from '../../../RelayApp';
import {requestBluetoothPermissions} from '../../utils/permissions';
import RelayBluetoothService from '../services/RelayBluetoothService';
import {getSelectedDevice, saveSelectedDevice} from '../store/relayStore';

type Props = NativeStackScreenProps<RelayStackParamList, 'DevicePicker'>;

interface DeviceItem {
  address: string;
  name: string;
  lastUsed: boolean;
}

export default function DevicePickerScreen({navigation}: Props) {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [noDevices, setNoDevices] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    setNoDevices(false);

    const granted = await requestBluetoothPermissions();
    if (!granted) {
      setScanning(false);
      return;
    }

    try {
      const all = await RelayBluetoothService.listBondedDevices();
      const saved = await getSelectedDevice();

      // Filter for NoHack devices first
      const nohacks = all.filter(
        d => d.name && d.name.toLowerCase().includes('nohack'),
      );
      const list = nohacks.length > 0 ? nohacks : all;

      const items: DeviceItem[] = list.map(d => ({
        address: d.address,
        name: d.name,
        lastUsed: saved?.address === d.address,
      }));

      // Sort last-used first
      items.sort((a, b) => (b.lastUsed ? 1 : 0) - (a.lastUsed ? 1 : 0));

      setDevices(items);
      setNoDevices(items.length === 0);
    } catch {
      setDevices([]);
      setNoDevices(true);
    }
    setScanning(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      scan();
    }, [scan]),
  );

  const handleSelect = async (device: DeviceItem) => {
    const displayName = device.name.startsWith('NoHack ')
      ? device.name.substring(7)
      : device.name;

    await saveSelectedDevice({address: device.address, name: device.name});

    navigation.navigate('RelayMain', {
      address: device.address,
      name: device.name,
      displayName,
    });
  };

  const renderDevice = ({item}: {item: DeviceItem}) => (
    <TouchableOpacity
      style={styles.deviceBtn}
      activeOpacity={0.7}
      onPress={() => handleSelect(item)}>
      <View style={styles.deviceDot} />
      <Text style={styles.deviceName}>{item.name}</Text>
      {item.lastUsed && <Text style={styles.deviceTag}>last used</Text>}
      <Text style={styles.connectTag}>Connect →</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor="#16162A" barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.title}>
          <Text style={styles.titleNo}>NO</Text>HACK <Text style={styles.titleAccent}>RELAY</Text>
        </Text>
      </View>

      <Text style={styles.heading}>Select your NoHack device:</Text>

      {scanning ? (
        <ActivityIndicator color="#4CAF50" size="large" style={{marginTop: 40}} />
      ) : noDevices ? (
        <Text style={styles.noDevices}>
          No NoHack devices found.{'\n'}Pair your phone in Bluetooth settings
          first.
        </Text>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={d => d.address}
          renderItem={renderDevice}
          contentContainerStyle={styles.list}
        />
      )}

      <TouchableOpacity style={styles.refreshBtn} onPress={scan}>
        <Text style={styles.refreshText}>Refresh devices</Text>
      </TouchableOpacity>
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
  heading: {
    fontSize: 14,
    color: '#888',
    marginBottom: 14,
    marginTop: 20,
    paddingHorizontal: 20,
  },
  list: {
    gap: 8,
    paddingHorizontal: 20,
  },
  deviceBtn: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    padding: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  deviceDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4CAF50',
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    flex: 1,
  },
  deviceTag: {
    fontSize: 11,
    color: '#666',
  },
  connectTag: {
    fontSize: 11,
    color: '#4CAF50',
  },
  noDevices: {
    color: '#666',
    fontSize: 13,
    paddingVertical: 20,
    paddingHorizontal: 20,
    lineHeight: 22,
  },
  refreshBtn: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignSelf: 'flex-start',
    marginTop: 12,
    marginLeft: 20,
    marginBottom: 24,
  },
  refreshText: {
    color: '#AAAAAA',
    fontSize: 13,
    fontWeight: '500',
  },
});
