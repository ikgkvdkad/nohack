import React, {useRef, useState, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Animated,
  Dimensions,
  LayoutChangeEvent,
} from 'react-native';

interface Props {
  onActivate: () => void;
  onSlide?: (position: number) => void;       // 0.0–1.0, fires during drag
  remotePosition?: number | null;              // 0.0–1.0, from other device
}

const THUMB_SIZE = 44;
const HORIZONTAL_PADDING = 20;
const SLIDE_THROTTLE_MS = 50; // throttle outgoing slide events

export default function KillSwitchSlider({onActivate, onSlide, remotePosition}: Props) {
  const pan = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);
  const [activated, setActivated] = useState(false);
  const [dragging, setDragging] = useState(false);
  const maxSlide = trackWidth - THUMB_SIZE;
  const lastSlideTime = useRef(0);

  // When remote sends a position, animate the thumb (only if we're not dragging locally)
  useEffect(() => {
    if (remotePosition != null && !dragging && maxSlide > 0 && !activated) {
      const x = remotePosition * maxSlide;
      pan.setValue(x);
      // If remote hit 90%+, activate
      if (remotePosition >= 0.9) {
        Animated.spring(pan, {
          toValue: maxSlide,
          useNativeDriver: false,
        }).start(() => {
          setActivated(true);
          onActivate();
        });
      }
    }
  }, [remotePosition]);

  const emitSlide = (x: number) => {
    if (!onSlide || maxSlide <= 0) return;
    const now = Date.now();
    if (now - lastSlideTime.current < SLIDE_THROTTLE_MS) return;
    lastSlideTime.current = now;
    onSlide(x / maxSlide);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        const x = Math.max(0, Math.min(gesture.dx, maxSlide));
        pan.setValue(x);
      },
      onPanResponderRelease: (_, gesture) => {
        if (maxSlide > 0 && gesture.dx >= maxSlide * 0.9) {
          Animated.spring(pan, {
            toValue: maxSlide,
            useNativeDriver: false,
          }).start(() => {
            setActivated(true);
            onActivate();
          });
        } else {
          Animated.spring(pan, {
            toValue: 0,
            useNativeDriver: false,
          }).start();
        }
      },
    }),
  ).current;

  // Re-create PanResponder when maxSlide changes
  const responder = useRef(panResponder);
  if (maxSlide > 0) {
    responder.current = PanResponder.create({
      onStartShouldSetPanResponder: () => !activated,
      onMoveShouldSetPanResponder: () => !activated,
      onPanResponderGrant: () => {
        setDragging(true);
      },
      onPanResponderMove: (_, gesture) => {
        const x = Math.max(0, Math.min(gesture.dx, maxSlide));
        pan.setValue(x);
        emitSlide(x);
      },
      onPanResponderRelease: (_, gesture) => {
        setDragging(false);
        if (maxSlide > 0 && gesture.dx >= maxSlide * 0.9) {
          onSlide?.(1.0); // notify remote of activation
          Animated.spring(pan, {
            toValue: maxSlide,
            useNativeDriver: false,
          }).start(() => {
            setActivated(true);
            onActivate();
          });
        } else {
          onSlide?.(0); // snap back — notify remote
          Animated.spring(pan, {
            toValue: 0,
            useNativeDriver: false,
          }).start();
        }
      },
    });
  }

  const handleLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const bgColor = pan.interpolate({
    inputRange: [0, maxSlide || 1],
    outputRange: ['rgba(229,57,53,0.15)', 'rgba(229,57,53,0.6)'],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.wrapper}>
      <Animated.View
        style={[styles.track, {backgroundColor: bgColor}]}
        onLayout={handleLayout}>
        <Text style={styles.label}>
          {activated ? 'RESETTING...' : 'SLIDE TO RESET'}
        </Text>
        <Animated.View
          style={[styles.thumb, {transform: [{translateX: pan}]}]}
          {...responder.current.panHandlers}>
          <Text style={styles.thumbIcon}>{' '}</Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 12,
    paddingBottom: 0,
  },
  track: {
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  label: {
    color: 'rgba(229,57,53,0.7)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 3,
    position: 'absolute',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#E53935',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    left: 0,
    elevation: 4,
    shadowColor: '#E53935',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.4,
    shadowRadius: 4,
  },
  thumbIcon: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
});
