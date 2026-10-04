import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useVitals } from '../context/VitalsContext';

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Nuevo paciente: pide un código o iniciales (no el nombre) y crea su sesión.
 * createNewSession también enlaza el ESP32 a la sesión nueva.
 */
export const NewPatientModal: React.FC<{ visible: boolean; onClose: () => void; onCreated?: () => void }> = ({
  visible, onClose, onCreated,
}) => {
  const { createNewSession } = useVitals();
  const [code, setCode] = useState('');
  useEffect(() => { if (visible) setCode(''); }, [visible]);
  const valid = clean(code).length > 0;

  const create = () => {
    if (!valid) return;
    createNewSession(code);
    onClose();
    onCreated?.();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <MaterialCommunityIcons name="account-plus" size={22} color={Colors.primary} />
            <Text style={styles.title}>Nuevo paciente</Text>
          </View>
          <Text style={styles.text}>
            Escribe un código o las iniciales (por ejemplo P017 o JPL), no el nombre completo. Aparece en el
            historial y en el informe. El dispositivo empieza a registrar en este paciente.
          </Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="Código o iniciales"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            autoFocus
            onSubmitEditing={create}
            accessibilityLabel="Código o iniciales del paciente"
          />
          {valid && <Text style={styles.preview}>Quedará como {clean(code)}_xxxxx</Text>}
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onClose} accessibilityRole="button">
              <Text style={styles.btnGhostText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, !valid && { opacity: 0.5 }]}
              onPress={create}
              disabled={!valid}
              accessibilityRole="button"
            >
              <Text style={styles.btnPrimaryText}>Crear paciente</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  title: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  text: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 12 },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 16, fontWeight: '700', color: Colors.textPrimary, backgroundColor: Colors.backgroundSecondary,
  },
  preview: { fontSize: 12, color: Colors.textSecondary, marginTop: 6 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  btn: { minHeight: 40, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: Colors.backgroundSecondary },
  btnGhostText: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  btnPrimary: { backgroundColor: Colors.primary },
  btnPrimaryText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
});
