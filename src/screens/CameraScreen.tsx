import React, {useRef, useState, useCallback} from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {Camera, CameraType} from 'react-native-camera-kit';
import RNFS from 'react-native-fs';
import ImageResizer from '@bam.tech/react-native-image-resizer';
import Svg, {Polyline, Line, Path} from 'react-native-svg';
import type {RootStackParamList} from '../types';

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 80;

type Nav = NativeStackNavigationProp<RootStackParamList, 'Camera'>;
type Route = RouteProp<RootStackParamList, 'Camera'>;

const ICON_COLOR = '#FFFFFF';

function BackIcon() {
  return (
    <Svg width={30} height={30} viewBox="0 0 512 512">
      <Polyline
        points="244 400 100 256 244 112"
        fill="none"
        stroke={ICON_COLOR}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={48}
      />
      <Line
        x1={120} y1={256} x2={412} y2={256}
        fill="none"
        stroke={ICON_COLOR}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={48}
      />
    </Svg>
  );
}

function FlipIcon() {
  return (
    <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
      <Path
        d="M11.5 20.5C6.80558 20.5 3 16.6944 3 12C3 7.30558 6.80558 3.5 11.5 3.5C16.1944 3.5 20 7.30558 20 12C20 13.5433 19.5887 14.9905 18.8698 16.238M22.5 15L18.8698 16.238M17.1747 12.3832L18.5289 16.3542L18.8698 16.238"
        stroke={ICON_COLOR}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export default function CameraScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const cameraRef = useRef<any>(null);
  const [capturing, setCapturing] = useState(false);
  const [facing, setFacing] = useState(CameraType.Back);

  const handleCapture = useCallback(async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    try {
      const result = await cameraRef.current.capture();
      const uri = result?.uri ?? result;
      if (uri) {
        const originalPath = uri.replace('file://', '');
        const resized = await ImageResizer.createResizedImage(
          uri,
          MAX_DIMENSION,
          MAX_DIMENSION,
          'JPEG',
          JPEG_QUALITY,
          0,
          undefined,
          false,
          {mode: 'contain', onlyScaleDown: true},
        );
        const resizedPath = resized.uri.replace('file://', '');
        const base64 = await RNFS.readFile(resizedPath, 'base64');
        RNFS.unlink(originalPath).catch(() => {});
        if (resizedPath !== originalPath) {
          RNFS.unlink(resizedPath).catch(() => {});
        }
        navigation.navigate('Chat', {
          contactKey: route.params.contactKey,
          photoBase64: base64,
        });
      } else {
        navigation.goBack();
      }
    } catch {
      navigation.goBack();
    }
  }, [capturing, navigation, route.params.contactKey]);

  const handleCancel = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleFlip = useCallback(() => {
    setFacing(f => (f === CameraType.Back ? CameraType.Front : CameraType.Back));
  }, []);

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={styles.camera}
        cameraType={facing}
        flashMode="off"
      />

      {/* Bottom bar: [back]  [shutter]  [flip] */}
      <View style={styles.bottomBar}>
        {/* Back / cancel */}
        <TouchableOpacity style={styles.sideBtn} onPress={handleCancel}>
          <BackIcon />
        </TouchableOpacity>

        {/* Shutter */}
        <TouchableOpacity
          style={styles.shutterBtn}
          onPress={handleCapture}
          disabled={capturing}>
          {capturing ? (
            <ActivityIndicator color="#000" size="large" />
          ) : (
            <View style={styles.shutterInner} />
          )}
        </TouchableOpacity>

        {/* Flip camera */}
        <TouchableOpacity style={styles.sideBtn} onPress={handleFlip}>
          <FlipIcon />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingBottom: 40,
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sideBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  shutterBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFF',
  },
});
