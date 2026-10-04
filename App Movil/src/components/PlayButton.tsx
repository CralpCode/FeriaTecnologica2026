import React, { useEffect, useState } from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { audioPlayer } from '../services/audioPlayer';

/** Botón para escuchar / detener una grabación guardada en el servidor. */
export const PlayButton: React.FC<{ url: string; size?: number }> = ({ url, size = 16 }) => {
  const [playing, setPlaying] = useState(audioPlayer.playing() === url);

  useEffect(() => audioPlayer.onChange((u) => setPlaying(u === url)), [url]);

  return (
    <TouchableOpacity
      style={[styles.btn, playing && styles.btnActive]}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      accessibilityRole="button"
      onPress={() => audioPlayer.toggle(url)}
      accessibilityLabel={playing ? 'Detener audio' : 'Escuchar grabación'}
    >
      <Ionicons name={playing ? 'stop' : 'play'} size={size} color={playing ? '#FFFFFF' : Colors.primary} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primarySoft,
  },
  btnActive: { backgroundColor: Colors.primary },
});
