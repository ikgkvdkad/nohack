import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RootStackParamList, NoHackFile} from '../types';
import {parseNoHackFile} from '../utils/nohack';
import {decrypt, getPrivateKey} from '../crypto/keys';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Read'>;
type Route = RouteProp<RootStackParamList, 'Read'>;

export default function ReadScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();

  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [contentType, setContentType] = useState<'text' | 'image' | 'mixed'>('text');
  const [senderKey, setSenderKey] = useState<string>('');
  const [isIntro, setIsIntro] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const file = parseNoHackFile(route.params.payload);
    if (!file) {
      setError('Could not parse message.');
      return;
    }

    setSenderKey(file.senderPublicKey);

    if (file.type === 'introduction') {
      setIsIntro(true);
      setPlaintext(null);
      return;
    }

    if (!file.encryptedBody) {
      setError('Message has no content.');
      return;
    }

    const decrypted = decrypt(file.encryptedBody, getPrivateKey());
    setPlaintext(decrypted);
    setContentType(file.contentType || 'text');
  }, [route.params.payload]);

  const handleDone = () => {
    // Wipe plaintext before navigating away
    setPlaintext(null);
    setSenderKey('');
    navigation.goBack();
  };

  const handleReply = () => {
    // Pass original message to Compose so user can see what they're replying to
    const params: RootStackParamList['Compose'] = {recipientPublicKey: senderKey};
    if (contentType === 'text' && plaintext) {
      params.originalText = plaintext;
      params.originalContentType = 'text';
    } else if (contentType === 'image' && plaintext) {
      params.originalImage = plaintext;
      params.originalContentType = 'image';
    } else if (contentType === 'mixed' && plaintext) {
      try {
        const mixed = JSON.parse(plaintext);
        if (mixed.text) params.originalText = mixed.text;
        if (mixed.image) params.originalImage = mixed.image;
        params.originalContentType = 'mixed';
      } catch {}
    }
    setPlaintext(null);
    setSenderKey('');
    navigation.replace('Compose', params);
  };

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {isIntro ? 'Introduction' : 'Message'}
        </Text>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : isIntro ? (
          <View>
            <Text style={styles.introLabel}>
              Someone shared their public key with you:
            </Text>
            <View style={styles.keyBox}>
              <Text style={styles.keyText} selectable>
                {senderKey}
              </Text>
            </View>
            <Text style={styles.introHint}>
              You can now send them an encrypted message.
            </Text>
          </View>
        ) : contentType === 'mixed' && plaintext ? (
          (() => {
            try {
              const mixed = JSON.parse(plaintext);
              return (
                <View>
                  {mixed.image && (
                    <Image
                      source={{uri: `data:image/jpeg;base64,${mixed.image}`}}
                      style={styles.image}
                      resizeMode="contain"
                    />
                  )}
                  {mixed.text ? (
                    <Text style={[styles.messageText, mixed.image && {marginTop: 16}]}>
                      {mixed.text}
                    </Text>
                  ) : null}
                </View>
              );
            } catch {
              return <Text style={styles.error}>Could not parse message.</Text>;
            }
          })()
        ) : contentType === 'image' && plaintext ? (
          <Image
            source={{uri: `data:image/jpeg;base64,${plaintext}`}}
            style={styles.image}
            resizeMode="contain"
          />
        ) : (
          <Text style={styles.messageText}>{plaintext}</Text>
        )}
      </ScrollView>

      <View style={[styles.footer, {paddingBottom: insets.bottom + 12}]}>
        {(senderKey && !error) ? (
          <TouchableOpacity style={styles.replyBtn} onPress={handleReply}>
            <Text style={styles.replyBtnText}>Reply</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.doneBtn} onPress={handleDone}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 20,
  },
  error: {
    color: '#E53935',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 40,
  },
  messageText: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 28,
  },
  image: {
    width: '100%',
    height: 400,
    borderRadius: 8,
  },
  introLabel: {
    color: '#AAAAAA',
    fontSize: 15,
    marginBottom: 16,
  },
  keyBox: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  keyText: {
    color: '#4CAF50',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  introHint: {
    color: '#888888',
    fontSize: 14,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  replyBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  replyBtnText: {
    color: '#1A1A2E',
    fontSize: 16,
    fontWeight: '600',
  },
  doneBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
  },
});
