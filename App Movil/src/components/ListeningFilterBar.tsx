import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { AuscultationMode } from '../types/vitals';
import {
  audioPlayer, ListeningFilter, FILTER_LABELS, resolveFilter, describeBand,
} from '../services/audioPlayer';

const OPTIONS: ListeningFilter[] = ['auto', 'none', 'bell', 'diaphragm', 'ai'];

const EXPLAIN: Record<Exclude<ListeningFilter, 'auto'>, string> = {
  none: 'Se escucha todo lo que captó el micrófono.',
  bell: 'Resalta los graves, como la campana (S3, S4, soplos graves). No recupera graves que el micrófono no captó.',
  diaphragm: 'Resalta los agudos, como el diafragma (sonidos respiratorios, S1/S2, la mayoría de los soplos) y quita los tonos graves del corazón.',
  ai: 'La misma banda de frecuencias que analizó la red neuronal de este foco.',
};

/**
 * Filtro para ESCUCHAR las grabaciones. No cambia el audio guardado ni el resultado de la IA.
 * Sin `mode` (p. ej. Historial, con grabaciones de corazón y de pulmón) explica ambos.
 */
export const ListeningFilterBar: React.FC<{ mode?: AuscultationMode }> = ({ mode }) => {
  const [choice, setChoice] = useState<ListeningFilter>(audioPlayer.getFilter());
  useEffect(() => audioPlayer.onFilterChange(setChoice), []);
  const modes: AuscultationMode[] = mode ? [mode] : ['corazon', 'pulmon'];

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="tune-vertical" size={16} color={Colors.primary} />
        <Text style={styles.title}>Filtro de escucha</Text>
      </View>
      <View style={styles.chips}>
        {OPTIONS.map((o) => (
          <TouchableOpacity
            key={o}
            style={[styles.chip, choice === o && styles.chipActive]}
            onPress={() => audioPlayer.setFilter(o)}
            accessibilityRole="button"
            accessibilityState={{ selected: choice === o }}
          >
            <Text style={[styles.chipText, choice === o && styles.chipTextActive]}>{FILTER_LABELS[o]}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {modes.map((m) => {
        const resolved = resolveFilter(choice, m);
        return (
          <Text key={m} style={styles.note}>
            <Text style={styles.strong}>
              {m === 'pulmon' ? 'Pulmón' : 'Corazón'}: {FILTER_LABELS[resolved].toLowerCase()} ({describeBand(choice, m)}).
            </Text>{' '}
            {EXPLAIN[resolved]}
          </Text>
        );
      })}
      <Text style={styles.small}>
        Solo cambia lo que escuchas: el audio guardado y el resultado de la IA no cambian. Cortes orientativos,
        no validados con este estetoscopio.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 14,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  title: { fontSize: 14, fontWeight: '800', color: Colors.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundSecondary,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  chipTextActive: { color: '#FFFFFF' },
  note: { fontSize: 12, color: Colors.textPrimary, lineHeight: 17 },
  strong: { fontWeight: '800' },
  small: { fontSize: 11, color: Colors.textSecondary, marginTop: 6, lineHeight: 15 },
});
