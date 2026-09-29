import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, useWindowDimensions } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Colors } from '../theme/colors';

interface PulseWaveProps {
  bpm: number;
  isAlert?: boolean;
}

const CANVAS_HEIGHT = 70;

export const PulseWave: React.FC<PulseWaveProps> = ({ bpm, isAlert = false }) => {
  const { width } = useWindowDimensions();
  const canvasWidth = Math.max(280, width - 48);
  const animatedValue = useRef(new Animated.Value(0)).current;

  // Modula la velocidad del barrido en base al ritmo cardíaco
  useEffect(() => {
    // A mayor BPM, animación más rápida
    const cycleDuration = Math.max(800, Math.min(2200, (60 / Math.max(bpm, 40)) * 1800));

    const animation = Animated.loop(
      Animated.timing(animatedValue, {
        toValue: 1,
        duration: cycleDuration,
        useNativeDriver: true,
      })
    );
    animation.start();

    return () => animation.stop();
  }, [bpm, animatedValue]);

  // Ruta ECG clásica (onda P-Q-R-S-T)
  const generateEcgPath = () => {
    const w = canvasWidth;
    const mid = CANVAS_HEIGHT / 2;
    // Puntos característicos de electrocardiograma
    return `
      M 0 ${mid}
      L ${w * 0.15} ${mid}
      Q ${w * 0.2} ${mid - 6}, ${w * 0.25} ${mid}
      L ${w * 0.35} ${mid}
      L ${w * 0.38} ${mid + 8}
      L ${w * 0.42} ${mid - 28}
      L ${w * 0.46} ${mid + 20}
      L ${w * 0.49} ${mid}
      L ${w * 0.58} ${mid}
      Q ${w * 0.65} ${mid - 12}, ${w * 0.72} ${mid}
      L ${w} ${mid}
    `;
  };

  const strokeColor = isAlert ? Colors.danger : bpm > 95 ? Colors.warning : Colors.heartRate;

  return (
    <View style={styles.container}>
      <Svg width={canvasWidth} height={CANVAS_HEIGHT} viewBox={`0 0 ${canvasWidth} ${CANVAS_HEIGHT}`}>
        <Defs>
          <LinearGradient id="pulseGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor={strokeColor} stopOpacity={0.2} />
            <Stop offset="50%" stopColor={strokeColor} stopOpacity={1} />
            <Stop offset="100%" stopColor={strokeColor} stopOpacity={0.3} />
          </LinearGradient>
        </Defs>
        <Path
          d={generateEcgPath()}
          fill="none"
          stroke="url(#pulseGradient)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>

      {/* Punto de barrido láser animado que recorre la pantalla */}
      <Animated.View
        style={[
          styles.sweepPoint,
          {
            backgroundColor: '#FFF',
            borderColor: strokeColor,
            shadowColor: strokeColor,
            transform: [
              {
                translateX: animatedValue.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-canvasWidth / 2 + 10, canvasWidth / 2 - 10],
                }),
              },
            ],
          },
        ]}
      />

      {/* Onda de brillo animada superpuesta */}
      <Animated.View
        style={[
          styles.glowEffect,
          {
            backgroundColor: strokeColor,
            opacity: animatedValue.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0.15, 0.45, 0.15],
            }),
            transform: [
              {
                scale: animatedValue.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [0.95, 1.05, 0.95],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    height: CANVAS_HEIGHT,
    marginVertical: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  sweepPoint: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    top: CANVAS_HEIGHT / 2 - 4,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 4,
  },
  glowEffect: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    zIndex: -1,
  },
});
