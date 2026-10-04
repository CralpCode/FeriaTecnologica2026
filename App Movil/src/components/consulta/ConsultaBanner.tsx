import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '../ui/Text';
import { Ionicons } from '@expo/vector-icons';
import { useConsultaProgress } from '../../hooks/useConsultaProgress';
import { color, font, radius, space, weight } from '../../theme/tokens';

/** Aviso compacto en Monitoreo: consulta en curso y su siguiente paso, con acceso directo. */
export const ConsultaBanner: React.FC<{ onOpen: (step: number) => void }> = ({ onOpen }) => {
  const { steps, completed } = useConsultaProgress();
  const nextIndex = steps.findIndex((s, i) => i < 5 && s.state !== 'done');
  const target = nextIndex === -1 ? 5 : nextIndex;
  return (
    <TouchableOpacity style={styles.box} onPress={() => onOpen(target)} accessibilityRole="button"
                      accessibilityLabel={`Ir a la consulta, siguiente paso: ${steps[target].label}`}>
      <Ionicons name="clipboard-outline" size={22} color={color.primary} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title} numberOfLines={1}>Consulta de {steps[0].detail} · {completed}/5 pasos</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {nextIndex === -1 ? 'Lista para ver el resultado' : `Siguiente: ${steps[target].label}`}
        </Text>
      </View>
      <Text style={styles.go}>Ir</Text>
      <Ionicons name="chevron-forward" size={18} color={color.primary} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.lg,
    backgroundColor: color.primarySoft, borderWidth: 1, borderColor: color.primaryBorder, borderRadius: radius.md,
    marginBottom: space.lg, cursor: 'pointer' as any,
  },
  title: { fontSize: font.sm, fontWeight: weight.heavy, color: color.text },
  sub: { fontSize: font.xs, color: color.textSecondary, marginTop: 2 },
  go: { fontSize: font.sm, fontWeight: weight.heavy, color: color.primary },
});
