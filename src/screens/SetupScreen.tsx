import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RootStackParamList} from '../types';
import {saveDeviceName, markSetupComplete} from '../store/setupStore';
import {keyToName} from '../utils/deviceName';
import {initKeys, getPublicKey} from '../crypto/keys';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Setup'>;

type Phase = 'loading' | 'ready';

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const [phase, setPhase] = useState<Phase>('loading');
  const [deviceName, setDeviceName] = useState('');
  const [loadingStep, setLoadingStep] = useState('Initializing...');
  const checkAnim = useRef(new Animated.Value(0)).current;

  // Checkmark animation + auto-proceed
  useEffect(() => {
    if (phase === 'ready') {
      Animated.spring(checkAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }).start();

      const timer = setTimeout(async () => {
        await markSetupComplete();
        navigation.replace('Pin');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [phase, checkAnim, navigation]);

  // Setup: generate keys and device name
  useEffect(() => {
    (async () => {
      setLoadingStep('Generating secret keys...');
      await initKeys();

      setLoadingStep('Creating device identity...');
      const derivedName = keyToName(getPublicKey());
      const name = `NoHack ${derivedName}`;
      await saveDeviceName(name);
      setDeviceName(name);

      setPhase('ready');
    })();
  }, []);

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      <View style={styles.content}>
        <Text style={styles.title}>Set up your NoHack</Text>

        {/* Loading */}
        {phase === 'loading' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.loadingStep}>{loadingStep}</Text>
          </View>
        )}

        {/* Ready */}
        {phase === 'ready' && (
          <View style={styles.center}>
            <Animated.View
              style={[
                styles.checkCircle,
                {transform: [{scale: checkAnim}]},
              ]}>
              <Text style={styles.checkMark}>✓</Text>
            </Animated.View>
            <Text style={styles.successText}>Ready!</Text>
            {deviceName !== '' && (
              <View style={styles.nameCard}>
                <Text style={styles.nameLabel}>Your device name</Text>
                <Text style={styles.nameValue}>{deviceName}</Text>
              </View>
            )}
            <Text style={styles.subtext}>
              Connect your relay phone via USB to start messaging.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1A',
  },
  content: {
    flex: 1,
    padding: 32,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 32,
  },
  nameCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  nameLabel: {
    color: '#888888',
    fontSize: 14,
    marginBottom: 8,
  },
  nameValue: {
    color: '#4CAF50',
    fontSize: 28,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 2,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  loadingStep: {
    color: '#888888',
    fontSize: 15,
    marginTop: 20,
    textAlign: 'center',
  },
  checkCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  checkMark: {
    color: '#FFFFFF',
    fontSize: 48,
    fontWeight: '700',
  },
  successText: {
    color: '#4CAF50',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 16,
  },
  subtext: {
    color: '#888888',
    fontSize: 15,
    textAlign: 'center',
  },
});
