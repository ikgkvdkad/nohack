import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RelayStackParamList} from '../../../RelayApp';
import RelayTelegramService from '../services/RelayTelegramService';

type Props = NativeStackScreenProps<RelayStackParamList, 'TelegramSetup'>;

export default function TelegramSetupScreen({navigation}: Props) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'phone' | 'code' | 'password'>('phone');

  // Poll for auth state changes (code accepted → password needed → done)
  useEffect(() => {
    if (step !== 'code' && step !== 'password') return;

    const interval = setInterval(() => {
      if (RelayTelegramService.getStatus() === 'online') {
        // Auth completed successfully
        clearInterval(interval);
        navigation.replace('RelayMain');
      } else if (step === 'code' && RelayTelegramService.isWaitingForPassword()) {
        // Code accepted, 2FA password needed
        setStep('password');
        setLoading(false);
        setError('');
      }
    }, 500);

    return () => clearInterval(interval);
  }, [step, navigation]);

  // Auto-read verification code from Telegram service notifications
  useEffect(() => {
    if (step !== 'code') return;
    const unsub = RelayTelegramService.onAutoCode(autoCode => {
      setCode(autoCode);
      setLoading(true);
    });
    return unsub;
  }, [step]);

  const handleSendCode = async () => {
    const trimmed = phone.trim();
    if (!trimmed) {
      setError('Phone number required (e.g. +31612345678)');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await RelayTelegramService.requestCode(trimmed);
      // Wait a moment for SMS to be dispatched
      setTimeout(() => {
        setStep('code');
        setLoading(false);
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to send code');
      setLoading(false);
    }
  };

  const handleSubmitCode = () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setError('Enter the code from Telegram/SMS');
      return;
    }
    setLoading(true);
    setError('');
    const accepted = RelayTelegramService.submitCode(trimmed);
    if (!accepted) {
      setError('Not waiting for a code. Try again.');
      setLoading(false);
    }
    // Polling in useEffect will detect success or password needed
  };

  const handleSubmitPassword = () => {
    const trimmed = password.trim();
    if (!trimmed) {
      setError('Enter your 2FA password');
      return;
    }
    setLoading(true);
    setError('');
    const accepted = RelayTelegramService.submitPassword(trimmed);
    if (!accepted) {
      setError('Not waiting for password. Try again.');
      setLoading(false);
    }
    // Polling in useEffect will detect success
  };

  const handleSkip = () => {
    navigation.replace('RelayMain');
  };

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor="#16162A" barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.title}>
          <Text style={styles.titleNo}>NO</Text>HACK <Text style={styles.titleAccent}>RELAY</Text>
        </Text>
      </View>
      <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Login with Telegram</Text>
        <Text style={styles.description}>
          Log in with your Telegram account to automatically relay messages.
          Your Telegram username becomes your reachable address.
        </Text>

        {step === 'phone' && (
          <>
            <Text style={styles.label}>Phone number</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+31 6 12345678"
              placeholderTextColor="#555"
              keyboardType="phone-pad"
              autoFocus
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.btnDisabled]}
              onPress={handleSendCode}
              disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Send Code</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {step === 'code' && (
          <>
            <Text style={styles.label}>Verification code</Text>
            <Text style={styles.hint}>
              Enter the code sent to your Telegram app (or via SMS).
            </Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder="12345"
              placeholderTextColor="#555"
              keyboardType="number-pad"
              autoFocus
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.btnDisabled]}
              onPress={handleSubmitCode}
              disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Verify</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {step === 'password' && (
          <>
            <Text style={styles.label}>Two-factor password</Text>
            <Text style={styles.hint}>
              Your account has 2FA enabled. Enter your cloud password.
            </Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#555"
              secureTextEntry
              autoFocus
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.btnDisabled]}
              onPress={handleSubmitPassword}
              disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Submit</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
          <Text style={styles.skipBtnText}>Skip — use clipboard only</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0F0F1A'},
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#16162A',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: {fontSize: 18, fontWeight: '600', letterSpacing: 2, color: '#FFFFFF'},
  titleNo: {color: '#E53935'},
  titleAccent: {color: '#4CAF50'},
  body: {flex: 1, padding: 24},
  heading: {color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginBottom: 12},
  description: {color: '#888', fontSize: 14, lineHeight: 22, marginBottom: 32},
  label: {color: '#888', fontSize: 12, letterSpacing: 1, marginBottom: 6, marginTop: 16},
  hint: {color: '#666', fontSize: 13, lineHeight: 20, marginBottom: 8},
  input: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 18,
    letterSpacing: 2,
  },
  error: {color: '#E53935', fontSize: 13, marginTop: 12},
  primaryBtn: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  primaryBtnText: {color: '#FFFFFF', fontSize: 16, fontWeight: '600'},
  skipBtn: {paddingVertical: 16, alignItems: 'center', marginTop: 8},
  skipBtnText: {color: '#666', fontSize: 14},
  btnDisabled: {opacity: 0.5},
});
