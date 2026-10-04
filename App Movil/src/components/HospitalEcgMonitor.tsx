import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { Text } from './ui/Text';
import Svg, { Path } from 'react-native-svg';

export interface HospitalEcgMonitorProps {
  bpm?: number;
  heartRate?: number;
  bloodOxygen?: number;
  systolicPressure?: number;
  diastolicPressure?: number;
  audioDecibels?: number;
  isAlert?: boolean;
}

const MONITOR_HEIGHT = 110;
const BEAT_WIDTH = 150;
const NUM_BEATS = 20;
const TOTAL_WIDTH = BEAT_WIDTH * NUM_BEATS;

export const HospitalEcgMonitor: React.FC<HospitalEcgMonitorProps> = ({
  bpm,
  heartRate,
  bloodOxygen,
  systolicPressure,
  diastolicPressure,
  audioDecibels,
  isAlert = false,
}) => {
  const currentBpm = bpm !== undefined ? bpm : (heartRate !== undefined ? heartRate : 0);
  const [containerWidth, setContainerWidth] = useState<number>(360);
  const [isLiveActive, setIsLiveActive] = useState<boolean>(currentBpm > 0);
  const liveTimeoutRef = useRef<any>(null);
  const canvasRef = useRef<any>(null);
  const offsetRef = useRef<number>(0);

  const nativeScrollAnim = useRef(new Animated.Value(0)).current;

  // Estabilizador con período de gracia para evitar que caídas momentáneas de paquetes corten la animación
  useEffect(() => {
    if (currentBpm > 0) {
      if (liveTimeoutRef.current) {
        clearTimeout(liveTimeoutRef.current);
        liveTimeoutRef.current = null;
      }
      setIsLiveActive(true);
    } else {
      if (!liveTimeoutRef.current) {
        liveTimeoutRef.current = setTimeout(() => {
          setIsLiveActive(false);
          liveTimeoutRef.current = null;
        }, 2500);
      }
    }

    return () => {
      if (liveTimeoutRef.current) {
        clearTimeout(liveTimeoutRef.current);
      }
    };
  }, [currentBpm]);

  const isLive = isLiveActive || currentBpm > 0;
  const ecgColor = !isLive ? '#94A3B8' : isAlert ? '#DC2626' : currentBpm > 100 ? '#B45309' : '#1D4ED8';

  // Complejo electrocardiográfico fisiológico P-Q-R-S-T
  const getEcgY = (xNorm: number) => {
    if (!isLive) return 0;
    if (xNorm < 0.16) return 0;
    if (xNorm < 0.28) {
      const p = (xNorm - 0.16) / 0.12;
      return -Math.sin(p * Math.PI) * 6; // Onda P
    }
    if (xNorm < 0.36) return 0;
    if (xNorm < 0.39) {
      const q = (xNorm - 0.36) / 0.03;
      return q * 4; // Onda Q
    }
    if (xNorm < 0.44) {
      const r = (xNorm - 0.39) / 0.05;
      return 4 - r * 42; // Disparo R vertical (-38px)
    }
    if (xNorm < 0.49) {
      const s = (xNorm - 0.44) / 0.05;
      return -38 + s * 54; // Descenso S (+16px)
    }
    if (xNorm < 0.53) {
      const b = (xNorm - 0.49) / 0.04;
      return 16 - b * 16; // Retorno a línea base
    }
    if (xNorm < 0.64) return 0;
    if (xNorm < 0.84) {
      const t = (xNorm - 0.64) / 0.20;
      return -Math.sin(t * Math.PI) * 10; // Onda T
    }
    return 0;
  };

  // 1. MOTOR PARA WEB (Canvas 2D con dirección natural y velocidad médica suave)
  useEffect(() => {
    if (Platform.OS !== 'web' || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let running = true;
    const midY = MONITOR_HEIGHT / 2 + 4;
    
    // Velocidad suave y natural calibrada a 25 mm/s
    const targetBpm = Math.max(50, Math.min(160, currentBpm || 75));
    const speed = (targetBpm / 75) * 0.75;

    const renderLoop = () => {
      if (!running) return;

      const w = canvas.width;
      const h = canvas.height;

      // Fondo hospitalario suave con rejilla médica
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(0, 0, w, h);

      // Rejilla médica milimétrica (5mm menor, 25mm mayor)
      ctx.lineWidth = 0.5;
      const gridMinor = 6;
      const gridMajor = 30;

      for (let x = 0; x < w; x += gridMinor) {
        const isMajor = x % gridMajor === 0;
        ctx.strokeStyle = isMajor ? '#E2E8F0' : '#EEF2F6';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      for (let y = 0; y < h; y += gridMinor) {
        const isMajor = y % gridMajor === 0;
        ctx.strokeStyle = isMajor ? '#E2E8F0' : '#EEF2F6';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Dirección natural: El papel avanza desplazando la señal hacia la izquierda
      if (isLive) {
        offsetRef.current = (offsetRef.current + speed) % BEAT_WIDTH;
      } else {
        offsetRef.current = 0;
      }

      // Dibujar trazo continuo de la onda ECG
      ctx.lineWidth = isLive ? 2.5 : 1.8;
      ctx.strokeStyle = ecgColor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();

      const probeX = Math.max(40, w - 26);
      let tracerY = midY;

      for (let x = 0; x <= w; x += 1.5) {
        const xOnStrip = x + offsetRef.current;
        const phase = ((xOnStrip % BEAT_WIDTH) + BEAT_WIDTH) % BEAT_WIDTH;
        const yOffset = isLive ? getEcgY(phase / BEAT_WIDTH) : 0;
        const y = midY + yOffset;

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        if (Math.abs(x - probeX) <= 1) {
          tracerY = y;
        }
      }
      ctx.stroke();

      // Punto rastreador luminoso en la punta
      if (isLive) {
        ctx.save();
        ctx.shadowColor = ecgColor;
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = ecgColor;
        ctx.lineWidth = 2.5;

        ctx.beginPath();
        ctx.arc(probeX, tracerY, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(probeX, tracerY, 8.5, 0, Math.PI * 2);
        ctx.strokeStyle = `${ecgColor}50`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);

    return () => {
      running = false;
      cancelAnimationFrame(animId);
    };
  }, [currentBpm, isLive, ecgColor, containerWidth]);

  // 2. MOTOR PARA EXPO NATIVO (iOS / Android) - Bucle continuo por Hardware
  useEffect(() => {
    if (Platform.OS === 'web') return;

    if (!isLive) {
      nativeScrollAnim.stopAnimation();
      nativeScrollAnim.setValue(0);
      return;
    }

    // Velocidad constante y calibrada a estándar clínico de 25 mm/s (~1.8s por ciclo)
    // El bucle corre ininterrumpido sin reinicios bruscos de posición al variar el BPM
    const duration = 1800;

    const loop = Animated.loop(
      Animated.timing(nativeScrollAnim, {
        toValue: -BEAT_WIDTH,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    loop.start();

    return () => {
      loop.stop();
    };
  }, [isLive]);

  // Generador de Onda ECG P-Q-R-S-T Hospitalaria en SVG
  const midY = MONITOR_HEIGHT / 2 + 4;
  const NUM_BEATS = 6; // 6 beats * 150 = 900px, suficiente para cubrir pantallas móviles y ciclo continuo
  const TOTAL_WIDTH = BEAT_WIDTH * NUM_BEATS;

  // Memoizado para evitar recalcular 900 puntos en cada render cuando llegan datos de sensores
  const nativeEcgPath = React.useMemo(() => {
    let path = `M 0 ${midY}`;
    for (let x = 0; x <= TOTAL_WIDTH; x += 2) {
      const phase = ((x % BEAT_WIDTH) + BEAT_WIDTH) % BEAT_WIDTH;
      const yOffset = isLive ? getEcgY(phase / BEAT_WIDTH) : 0;
      const y = Math.round((midY + yOffset) * 10) / 10;
      path += ` L ${x} ${y}`;
    }
    return path;
  }, [isLive, midY]);

  // Memoizado de rejilla médica
  const nativeGridLines = React.useMemo(() => {
    const lines = [];
    const w = Math.max(360, containerWidth);
    for (let x = 0; x < w; x += 30) {
      lines.push(
        <Path
          key={`vx-${x}`}
          d={`M ${x} 0 L ${x} ${MONITOR_HEIGHT}`}
          stroke="#E2E8F0"
          strokeWidth={0.8}
        />
      );
    }
    for (let y = 0; y < MONITOR_HEIGHT; y += 30) {
      lines.push(
        <Path
          key={`hy-${y}`}
          d={`M 0 ${y} L ${w} ${y}`}
          stroke="#E2E8F0"
          strokeWidth={0.8}
        />
      );
    }
    return lines;
  }, [containerWidth]);

  // Posición responsiva del cursor rastreador (26px antes del borde derecho, igual que Web)
  const probeX = Math.max(40, containerWidth - 26);

  // Interpolación de fase continua y memoizada: a v = -BEAT_WIDTH y v = 0 el valor es idéntico al 100%
  const dotTranslateY = React.useMemo(() => {
    const sampleInputs: number[] = [];
    const sampleOutputs: number[] = [];
    const numSamples = 60;

    for (let i = 0; i <= numSamples; i++) {
      const v = -BEAT_WIDTH + (i / numSamples) * BEAT_WIDTH;
      sampleInputs.push(v);

      const phase = (((probeX - v) % BEAT_WIDTH) + BEAT_WIDTH) % BEAT_WIDTH;
      const yOffset = isLive ? getEcgY(phase / BEAT_WIDTH) : 0;
      sampleOutputs.push(yOffset);
    }

    return nativeScrollAnim.interpolate({
      inputRange: sampleInputs,
      outputRange: sampleOutputs,
    });
  }, [probeX, isLive, nativeScrollAnim]);

  return (
    <View
      style={styles.monitorContainer}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w > 50 && w !== containerWidth) {
          setContainerWidth(w);
        }
      }}
    >
      {/* Cabecera Técnica */}
      <View style={styles.monitorHeader}>
        <View style={styles.headerLeft}>
          <Text style={[styles.leadText, { color: ecgColor }]}>PULSO (MAX30102)</Text>
          <Text style={styles.specText}>Animación ilustrativa al ritmo medido • no es un ECG</Text>
        </View>

        <View style={styles.headerRight}>
          <View
            style={[
              styles.liveStreamingBadge,
              {
                backgroundColor: isLive ? '#DCFCE7' : '#F1F5F9',
                borderColor: isLive ? '#86EFAC' : '#CBD5E1',
              },
            ]}
          >
            <View
              style={[
                styles.liveBlinkDot,
                {
                  backgroundColor: isLive ? '#16A34A' : '#94A3B8',
                },
              ]}
            />
            <Text style={[styles.liveStreamingText, { color: isLive ? '#15803D' : '#64748B' }]}>
              {isLive ? 'EN VIVO' : 'STANDBY'}
            </Text>
          </View>

          <Text style={[styles.bpmBadge, { color: ecgColor }]}>
            {isLive ? `${currentBpm} BPM` : '-- BPM'}
          </Text>
        </View>
      </View>

      {/* Pantalla del Osciloscopio (Canvas en Web / SVG Animado en Nativo) */}
      <View style={styles.screenArea}>
        {Platform.OS === 'web' ? (
          // @ts-ignore
          <canvas
            ref={canvasRef}
            width={containerWidth}
            height={MONITOR_HEIGHT}
            style={{ width: '100%', height: MONITOR_HEIGHT, display: 'block' }}
          />
        ) : (
          <View style={{ width: '100%', height: MONITOR_HEIGHT, overflow: 'hidden' }}>
            {/* Rejilla médica de fondo */}
            <Svg
              style={StyleSheet.absoluteFill}
              width={containerWidth}
              height={MONITOR_HEIGHT}
            >
              {nativeGridLines}
            </Svg>

            {/* Onda ECG Continua Animada */}
            <Animated.View
              style={{
                position: 'absolute',
                left: 0,
                width: TOTAL_WIDTH,
                height: MONITOR_HEIGHT,
                transform: [{ translateX: isLive ? nativeScrollAnim : 0 }],
              }}
            >
              <Svg width={TOTAL_WIDTH} height={MONITOR_HEIGHT}>
                <Path
                  d={nativeEcgPath}
                  fill="none"
                  stroke={ecgColor}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Animated.View>

            {/* Punto rastreador luminoso alineado a probeX que sigue la silueta con precisión absoluta */}
            {isLive && (
              <Animated.View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: probeX - 5,
                  top: midY - 5,
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: '#FFFFFF',
                  borderColor: ecgColor,
                  borderWidth: 2.2,
                  transform: [{ translateY: dotTranslateY }],
                }}
              >
                <View
                  style={{
                    position: 'absolute',
                    left: -4,
                    top: -4,
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: ecgColor,
                    opacity: 0.28,
                  }}
                />
              </Animated.View>
            )}
          </View>
        )}
      </View>

      {/* Pie del Monitor */}
      <View style={styles.monitorFooter}>
        <Text style={styles.footerInfo}>SENSOR ÓPTICO • MAX30102</Text>
        <Text style={[styles.footerRhythm, { color: isLive ? (isAlert ? '#DC2626' : '#059669') : '#64748B' }]}>
          {isLive ? (isAlert ? '⚠ PULSO FUERA DE RANGO' : '✓ PULSO DETECTADO') : 'STANDBY • EN ESPERA'}
        </Text>
      </View>
    </View>
  );
};

export default React.memo(HospitalEcgMonitor);

const styles = StyleSheet.create({
  monitorContainer: {
    width: '100%',
    marginVertical: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  monitorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    marginRight: 8,
  },
  leadText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  specText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveStreamingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 0.5,
    marginRight: 8,
  },
  liveBlinkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  liveStreamingText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  bpmBadge: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  screenArea: {
    width: '100%',
    height: MONITOR_HEIGHT,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  monitorFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  footerInfo: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  footerRhythm: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
