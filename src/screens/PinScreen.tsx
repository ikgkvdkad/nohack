import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RootStackParamList} from '../types';
import {hasPin, setPin, verifyPin} from '../store/pinStore';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Pin'>;

export default function PinScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const [mode, setMode] = useState<'loading' | 'setup' | 'confirm' | 'unlock'>('loading');
  const [pin, setCurrentPin] = useState('');
  const [setupPin, setSetupPin] = useState('');
  const [error, setError] = useState('');
  const [fails, setFails] = useState(0);
  const [locked, setLocked] = useState(false);
  const shakeAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    hasPin().then(exists => setMode(exists ? 'unlock' : 'setup'));
  }, []);

  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, {toValue: 10, duration: 50, useNativeDriver: true}),
      Animated.timing(shakeAnim, {toValue: -10, duration: 50, useNativeDriver: true}),
      Animated.timing(shakeAnim, {toValue: 10, duration: 50, useNativeDriver: true}),
      Animated.timing(shakeAnim, {toValue: 0, duration: 50, useNativeDriver: true}),
    ]).start();
  }, [shakeAnim]);

  const handleDigit = useCallback(
    (digit: string) => {
      if (locked) return;
      if (pin.length >= 6) return;

      const next = pin + digit;
      setCurrentPin(next);
      setError('');

      if (next.length === 6) {
        setTimeout(async () => {
          if (mode === 'setup') {
            setSetupPin(next);
            setCurrentPin('');
            setMode('confirm');
          } else if (mode === 'confirm') {
            if (next === setupPin) {
              await setPin(next);
              navigation.replace('ChatList');
            } else {
              shake();
              setError('PINs do not match');
              setCurrentPin('');
              setMode('setup');
              setSetupPin('');
            }
          } else if (mode === 'unlock') {
            const ok = await verifyPin(next);
            if (ok) {
              navigation.replace('ChatList');
            } else {
              shake();
              const newFails = fails + 1;
              setFails(newFails);
              setCurrentPin('');
              if (newFails >= 3) {
                setLocked(true);
                setError('Too many attempts. Wait 30 seconds.');
                setTimeout(() => {
                  setLocked(false);
                  setFails(0);
                  setError('');
                }, 30000);
              } else {
                setError('Wrong PIN');
              }
            }
          }
        }, 100);
      }
    },
    [pin, mode, setupPin, fails, locked, navigation, shake],
  );

  const handleDelete = useCallback(() => {
    setCurrentPin(p => p.slice(0, -1));
    setError('');
  }, []);

  const title =
    mode === 'setup'
      ? 'Set your PIN'
      : mode === 'confirm'
      ? 'Confirm your PIN'
      : 'Enter PIN';

  const subtitle =
    mode === 'setup'
      ? 'Choose a 6-digit PIN to protect your NoHack'
      : mode === 'confirm'
      ? 'Enter the same PIN again'
      : '';

  if (mode === 'loading') return null;

  return (
    <View style={[styles.container, {paddingTop: insets.top + 60}]}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      <Animated.View
        style={[styles.dotsRow, {transform: [{translateX: shakeAnim}]}]}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <View
            key={i}
            style={[styles.dot, i < pin.length && styles.dotFilled]}
          />
        ))}
      </Animated.View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.keypad}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map(
          key => (
            <TouchableOpacity
              key={key || 'empty'}
              style={[styles.key, !key && styles.keyEmpty]}
              onPress={() => {
                if (key === 'del') handleDelete();
                else if (key) handleDigit(key);
              }}
              disabled={!key || locked}
              activeOpacity={0.6}>
              <Text style={styles.keyText}>
                {key === 'del' ? '⌫' : key}
              </Text>
            </TouchableOpacity>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1A',
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#888888',
    fontSize: 14,
    marginBottom: 40,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
    marginTop: 20,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: '#FFFFFF',
  },
  error: {
    color: '#E53935',
    fontSize: 14,
    marginTop: 8,
    height: 20,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 280,
    marginTop: 40,
    justifyContent: 'center',
  },
  key: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 6,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  keyEmpty: {
    backgroundColor: 'transparent',
  },
  keyText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '400',
  },
});
