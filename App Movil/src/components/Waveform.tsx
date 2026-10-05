import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { audioPlayer } from '../services/audioPlayer';
import { loadWaveform } from '../services/waveform';
import { AuscultationMode } from '../types/vitals';
import { color, font, radius, space, weight } from '../theme/tokens';
import { Text } from './ui/Text';
import { Skeleton } from './ui';

/**
 * Onda real de una grabación con botón para escucharla (usa el filtro de escucha elegido).
 * Mientras suena, la parte ya escuchada se pinta del color del resultado.
 */
export const Waveform: React.FC<{ url: string; mode?: AuscultationMode; tint?: string; height?: number; seconds?: number | null }> = ({
  url, mode, tint = color.primary, height = 56, seconds,
}) => {
  const [peaks, setPeaks] = useState<number[] | null | undefined>(undefined);
  const [w, setW] = useState(0);
  const [playing, setPlaying] = useState(audioPlayer.playing() === url);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let alive = true;
    setPeaks(undefined);
    loadWaveform(url).then((p) => alive && setPeaks(p));
    return () => { alive = false; };
  }, [url]);

  useEffect(() => audioPlayer.onChange((u) => { setPlaying(u === url); if (u !== url) setProgress(0); }), [url]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setProgress(audioPlayer.progress(url)), 80);
    return () => clearInterval(t);
  }, [playing, url]);

  const bars = peaks?.length || 0;
  const gap = 2;
  const barW = bars ? Math.max(1.5, (w - gap * (bars - 1)) / bars) : 0;

  return (
    <View style={styles.row}>
      <Pressable onPress={() => audioPlayer.toggle(url, mode)} accessibilityRole="button"
                 accessibilityLabel={playing ? 'Detener audio' : 'Escuchar grabación'}
                 style={(s: any) => [styles.play, { backgroundColor: playing ? tint : `${tint}14` }, s.pressed && { transform: [{ scale: 0.95 }] }]}>
        <Ionicons name={playing ? 'pause' : 'play'} size={20} color={playing ? '#FFFFFF' : tint} style={!playing && { marginLeft: 2 }} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ height }} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
              accessibilityLabel="Forma de onda de la grabación">
          {peaks === undefined && <Skeleton height={height} radius={radius.sm} />}
          {peaks === null && (
            <View style={[styles.noWave, { height }]}>
              <Text style={styles.noWaveText}>Toca reproducir para escuchar la grabación.</Text>
            </View>
          )}
          {!!peaks && w > 0 && (
            <Svg width={w} height={height}>
              {peaks.map((p, i) => {
                const bh = Math.max(2, p * (height - 4));
                const played = playing && i / bars <= progress;
                return <Rect key={i} x={i * (barW + gap)} y={(height - bh) / 2} width={barW} height={bh} rx={barW / 2}
                             fill={played ? tint : `${tint}55`} />;
              })}
            </Svg>
          )}
        </View>
        <View style={styles.meta}>
          <Text style={styles.metaText}>{playing ? 'Reproduciendo…' : 'Grabación real del estetoscopio'}</Text>
          {!!seconds && <Text style={styles.metaText}>{seconds.toFixed(1)} s</Text>}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  play: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' as any },
  noWave: { justifyContent: 'center', borderRadius: radius.sm, backgroundColor: color.surfaceMuted, paddingHorizontal: space.md },
  noWaveText: { fontSize: font.xs, color: color.textMuted },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  metaText: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.medium },
});
