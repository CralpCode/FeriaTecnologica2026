import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../ui/Text';
import { Button, Card, StatusPill } from '../ui';
import { apiService } from '../../services/api';
import { useClinical } from '../../context/ClinicalContext';
import { ExternalSpO2Reading } from '../../types/vitals';
import { color, font, radius, space, weight } from '../../theme/tokens';

/** External readings stay separate from sensor telemetry and follow the patient. */
export const ExternalSpO2Card: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const { refresh } = useClinical();
  const [reading, setReading] = useState<ExternalSpO2Reading | null>(null);
  const [value, setValue] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);

  useEffect(() => {
    const g = ++generation.current;
    let cancelled = false;
    setReading(null); setValue(''); setDeviceName(''); setOpen(false); setMessage(null); setLoading(true); setBusy(false);
    apiService.getExternalSpO2(sessionId)
      .then(result => { if (!cancelled && g === generation.current) setReading(result.reading); })
      .catch(() => { if (!cancelled && g === generation.current) setMessage('No se pudo consultar la lectura externa. Revisa la conexión y que el servidor admita esta opción.'); })
      .finally(() => { if (!cancelled && g === generation.current) setLoading(false); });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { cancelled = true; ++generation.current; clearInterval(timer); };
  }, [sessionId]);

  const save = async (remove = false) => {
    const g = generation.current;
    const raw = value.trim().replace(',', '.');
    const percent = Number(raw);
    if (!remove && (!/^\d{1,3}(\.\d+)?$/.test(raw) || !Number.isFinite(percent) || percent <= 0 || percent > 100)) {
      setMessage('Escribe el porcentaje del oxímetro, mayor que 0 y hasta 100.'); return;
    }
    setBusy(true); setMessage(null);
    try {
      const result = remove ? await apiService.removeExternalSpO2(sessionId)
        : await apiService.saveExternalSpO2(sessionId, percent, deviceName.trim() || 'Oxímetro externo');
      if (g !== generation.current) return;
      setReading(result.reading); setOpen(false); setValue('');
      setMessage(remove ? 'Lectura externa retirada.' : 'Lectura externa guardada para este paciente y disponible para la IA.');
      await refresh();
    } catch {
      if (g === generation.current) setMessage('No se pudo guardar. Revisa la conexión con el servidor.');
    } finally { if (g === generation.current) setBusy(false); }
  };
  const elapsed = reading ? now - Date.parse(reading.measured_at) : Infinity;
  const recent = !!reading?.active && elapsed >= 0 && elapsed <= reading.expires_after_seconds * 1000;
  useEffect(() => {
    if (reading?.active && !recent) {
      setReading(current => current ? { ...current, active: false } : null);
      refresh();
    }
  }, [reading?.active, recent, refresh]);
  return (
    <Card>
      <Text style={styles.title}>SpO₂ de oxímetro externo</Text>
      <Text style={styles.hint}>Registra el porcentaje que muestra otro oxímetro. Se identifica como ingreso manual y se usa durante 15 minutos en la valoración y la IA.</Text>
      {reading && <View style={{ marginTop: space.md }}>
        <Text accessibilityLabel={`SpO2 externa: ${reading.value} por ciento`} style={styles.value}>{reading.value} %</Text>
        <StatusPill label={recent ? 'Ingreso manual · externo' : 'Lectura anterior'} tone={recent ? 'primary' : 'warning'} />
        <Text style={styles.hint}>{reading.device_name} · {new Date(reading.measured_at).toLocaleString()}</Text>
        {!recent && <Text style={styles.hint}>Actualiza la medición para usarla en la valoración actual.</Text>}
      </View>}
      {!open && <Button label={reading ? 'Actualizar SpO2 externa' : 'Agregar SpO2 externa'} icon="create-outline"
        onPress={() => { setOpen(true); setMessage(null); setValue(''); setDeviceName(reading?.device_name || ''); }} disabled={loading || busy} style={{ marginTop: space.md }} />}
      {open && <View>
        <TextInput accessibilityLabel="SpO2 del oxímetro externo (%)" placeholder="SpO2 (%)" value={value} onChangeText={setValue}
          keyboardType="decimal-pad" editable={!busy} style={styles.input} />
        <TextInput accessibilityLabel="Nombre del oxímetro externo" placeholder="Marca o equipo (opcional)" value={deviceName}
          onChangeText={setDeviceName} maxLength={80} editable={!busy} style={styles.input} />
        <Button label="Guardar SpO2 externa" icon="save-outline" onPress={() => save()} loading={busy} style={{ marginTop: space.md }} />
        <Button label="Cancelar ingreso externo" variant="secondary" onPress={() => { setOpen(false); setMessage(null); setValue(''); }} disabled={busy} style={{ marginTop: space.sm }} />
      </View>}
      {reading && <Button label="Retirar SpO2 externa" variant="secondary" onPress={() => save(true)} disabled={busy || loading} style={{ marginTop: space.sm }} />}
      {message && <Text accessibilityRole="alert" style={styles.hint}>{message}</Text>}
    </Card>
  );
};
const styles = StyleSheet.create({
  title: { fontSize: font.md, fontWeight: weight.heavy, color: color.text },
  value: { fontSize: 32, fontWeight: weight.heavy, color: color.primary, marginBottom: space.sm },
  hint: { fontSize: font.sm, lineHeight: 20, color: color.textSecondary, marginTop: space.sm },
  input: { padding: space.md, marginTop: space.md, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, color: color.text, backgroundColor: color.surface },
});
