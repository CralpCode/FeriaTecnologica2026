import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../ui/Text';
import { Ionicons } from '@expo/vector-icons';
import { apiService } from '../../services/api';
import { mergeContext } from '../../services/questions';
import { color, font, radius, space, weight } from '../../theme/tokens';
import { Button, Card } from '../ui';

const MAX = 2000;

/** Notas libres del médico. Se guardan con el contexto del paciente y salen en el informe PDF. */
export const NotesCard: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const g = ++generation.current;
    setLoading(true); setMessage(null);
    apiService.getPatientContext(sessionId)
      .then((c) => { if (g === generation.current) { setText(c.notes || ''); setSaved(c.notes || ''); } })
      .catch(() => g === generation.current && setMessage({ ok: false, text: 'No se pudieron cargar las notas.' }))
      .finally(() => g === generation.current && setLoading(false));
  }, [sessionId]);

  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      // Se lee el contexto actual y solo se cambian las notas (los datos y síntomas quedan igual)
      const current = mergeContext(await apiService.getPatientContext(sessionId));
      const notes = text.trim() ? text.trim() : null;
      await apiService.savePatientContext(sessionId, { ...current, notes });
      setSaved(notes || '');
      setMessage({ ok: true, text: 'Notas guardadas. Saldrán en el informe PDF.' });
    } catch (e: any) {
      setMessage({ ok: false, text: `No se pudieron guardar: ${e?.message || e}` });
    } finally {
      setSaving(false);
    }
  };

  const dirty = text.trim() !== saved.trim();
  return (
    <Card>
      <View style={styles.head}>
        <View style={styles.icon}><Ionicons name="create-outline" size={18} color={color.primary} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>Notas del médico</Text>
          <Text style={styles.sub}>Texto libre para el informe. El sistema no lo usa en sus reglas ni lo envía a la IA.</Text>
        </View>
      </View>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={(t) => setText(t.slice(0, MAX))}
        editable={!loading}
        multiline
        placeholder={loading ? 'Cargando…' : 'Ej.: refiere palpitaciones nocturnas; se sugiere ecocardiograma.'}
        placeholderTextColor={color.textMuted}
        accessibilityLabel="Notas del médico"
      />
      <View style={styles.foot}>
        <Text style={styles.count}>{text.length}/{MAX}</Text>
        <Button label="Guardar notas" icon="save-outline" size="sm" onPress={save} loading={saving} disabled={!dirty || loading} />
      </View>
      {message && <Text style={[styles.message, { color: message.ok ? color.success : color.danger }]}>{message.text}</Text>}
    </Card>
  );
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  icon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: color.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: font.md, fontWeight: weight.heavy, color: color.text },
  sub: { fontSize: font.xs, color: color.textMuted, marginTop: 2 },
  input: {
    minHeight: 110, borderWidth: 1, borderColor: color.borderStrong, borderRadius: radius.md, padding: space.md,
    fontSize: font.sm, color: color.text, backgroundColor: color.surface, textAlignVertical: 'top', lineHeight: 20,
  },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  count: { fontSize: font.xs, color: color.textMuted },
  message: { fontSize: font.xs, fontWeight: weight.bold, marginTop: space.sm },
});
