import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';

interface PulsingHeartProps {
  bpm: number;
  isAlert?: boolean;
  size?: number;
}

export const PulsingHeart: React.FC<PulsingHeartProps> = ({ bpm, isAlert = false, size = 48 }) => {
  const heartScale = useRef(new Animated.Value(1)).current;
  const rippleScale = useRef(new Animated.Value(1)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;

  const isLive = bpm > 0;
  const activeColor = isAlert ? Colors.danger : bpm > 100 ? Colors.warning : Colors.heartRate;
  const color = isLive ? activeColor : Colors.textMuted;

  useEffect(() => {
    if (!isLive) {
      heartScale.setValue(1);
      rippleScale.setValue(1);
      rippleOpacity.setValue(0);
      return;
    }

    // Ciclo sincronizado exacto (1020ms) sin desfasajes ni saltos
    const heartbeatLoop = Animated.loop(
      Animated.sequence([
        // Primer golpe ventricular (Lub)
        Animated.timing(heartScale, {
          toValue: 1.24,
          duration: 140,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heartScale, {
          toValue: 1.05,
          duration: 120,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        // Segundo golpe ventricular (Dub)
        Animated.timing(heartScale, {
          toValue: 1.20,
          duration: 130,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heartScale, {
          toValue: 1.0,
          duration: 180,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        // Pausa diastólica de relajación
        Animated.delay(450),
      ])
    );

    const rippleLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(rippleScale, {
            toValue: 1.9,
            duration: 650,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(rippleOpacity, {
              toValue: 0.45,
              duration: 180,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(rippleOpacity, {
              toValue: 0,
              duration: 470,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ]),
        // Retorno y pausa síncrona sin corte visible
        Animated.timing(rippleScale, {
          toValue: 1,
          duration: 10,
          useNativeDriver: true,
        }),
        Animated.delay(360),
      ])
    );

    heartbeatLoop.start();
    rippleLoop.start();

    return () => {
      heartbeatLoop.stop();
      rippleLoop.stop();
    };
  }, [isLive]);

  return (
    <View style={[styles.container, { width: size * 1.8, height: size * 1.8 }]}>
      {isLive && (
        <Animated.View
          style={[
            styles.ripple,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: color,
              opacity: rippleOpacity,
              transform: [{ scale: rippleScale }],
            },
          ]}
        />
      )}

      <View
        style={[
          styles.glowCenter,
          {
            width: size * 1.1,
            height: size * 1.1,
            borderRadius: (size * 1.1) / 2,
            backgroundColor: isLive ? color + '20' : 'transparent',
          },
        ]}
      />

      <Animated.View style={{ transform: [{ scale: heartScale }] }}>
        <MaterialCommunityIcons name={isLive ? "heart-pulse" : "heart-outline"} size={size} color={color} />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ripple: {
    position: 'absolute',
    borderWidth: 1.5,
  },
  glowCenter: {
    position: 'absolute',
  },
});
