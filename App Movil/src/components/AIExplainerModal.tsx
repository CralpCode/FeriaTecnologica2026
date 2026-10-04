import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useModalLayout } from '../hooks/useLayout';
import { apiService } from '../services/api';
import { HeartModelInfo, LungModelsInfo } from '../types/vitals';

const pct = (v?: number) => (v === undefined || v === null || isNaN(v) ? '—' : `${Math.round(v * 100)} %`);

const TRAIT_NAMES: Record<string, string> = {
  intensidad: 'Intensidad (leve o moderado/fuerte)',
  forma: 'Forma (meseta, decreciente o romboidal)',
  momento: 'Momento dentro del latido',
  tono: 'Tono (grave, medio o agudo)',
  calidad: 'Calidad (áspero o soplante)',
};

/** "¿Cómo funciona la IA?": explicación en lenguaje simple con los porcentajes reales del servidor. */
export const AIExplainerModal: React.FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
  const modal = useModalLayout();
  const [heart, setHeart] = useState<HeartModelInfo | null>(null);
  const [lung, setLung] = useState<LungModelsInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setError(false);
    apiService
      .getModelsInfo()
      .then((m) => {
        setHeart(m.corazon);
        setLung(m.pulmon);
      })
      .catch(() => setError(true));
  }, [visible]);

  const m = heart?.metricas_prueba;
  const traits = Object.entries(heart?.caracterizacion_soplo || {});
  const lungCnn = !!(lung?.lung_sounds_cnn?.loaded || lung?.lung_disease_cnn?.loaded);
  const base = lung?.modelo_base;

  return (
    <Modal visible={visible} animationType={modal.animationType} transparent onRequestClose={onClose}>
      <View style={[styles.overlay, modal.overlay]}>
        <View style={[styles.sheet, modal.sheet]}>
          <View style={styles.header}>
            <MaterialCommunityIcons name="brain" size={22} color={Colors.aiPurple} />
            <Text style={styles.title}>¿Cómo funciona la IA?</Text>
            <TouchableOpacity onPress={onClose} style={styles.close}>
              <Ionicons name="close" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            <Text style={styles.lead}>
              SpiroScan tiene tres partes que trabajan juntas: un <Text style={styles.b}>oído</Text> que escucha el
              sonido, unas <Text style={styles.b}>reglas</Text> que deciden si hay alerta y una{' '}
              <Text style={styles.b}>voz</Text> que lo explica. Nada de esto es un diagnóstico: sirve para decidir a
              quién referir a un médico.
            </Text>

            {!heart && !error && <ActivityIndicator color={Colors.primary} style={{ marginVertical: 16 }} />}
            {error && <Text style={styles.warn}>No se pudo consultar el servidor para mostrar los porcentajes.</Text>}

            <Section icon="heart-pulse" color={Colors.heartRate} title="1. El oído del corazón (red neuronal)">
              <Text style={styles.p}>
                Convierte los 15 segundos de audio en una "foto" del sonido (espectrograma) y una red neuronal
                convolucional aprende a reconocer cómo se ve un latido normal y uno anormal. Aprendió con miles de
                grabaciones reales de dos bases públicas: CirCor (2022) y PhysioNet (2016).
              </Text>
              {m && (
                <View style={styles.statsRow}>
                  <Stat value={pct(m.sensibilidad)} label="de los latidos anormales los detecta" />
                  <Stat value={pct(m.especificidad)} label="de los normales los reconoce como normales" />
                </View>
              )}
              {m && (
                <Text style={styles.small}>
                  Medido con {m.n} grabaciones de pacientes que la red nunca vio al aprender.
                </Text>
              )}
            </Section>

            <Section icon="waveform" color={Colors.aiPurple} title="2. Cómo suena el soplo">
              <Text style={styles.p}>
                Si el oído detecta un posible soplo, un segundo modelo describe cómo suena. Solo mostramos lo que
                acierta claramente más que adivinando al azar; lo demás queda oculto.
              </Text>
              {traits.map(([k, t]) => (
                <View key={k} style={styles.traitRow}>
                  <Ionicons
                    name={t.mostrar ? 'checkmark-circle' : 'eye-off-outline'}
                    size={15}
                    color={t.mostrar ? Colors.success : Colors.textMuted}
                  />
                  <Text style={[styles.traitText, !t.mostrar && { color: Colors.textMuted }]}>
                    {TRAIT_NAMES[k] || k}: acierta {pct(t.exactitud_balanceada)} (al azar: {pct(t.azar)})
                    {t.mostrar ? '' : ' · no se muestra'}
                  </Text>
                </View>
              ))}
              <Text style={styles.small}>Describe el sonido; no dice la causa del soplo.</Text>
            </Section>

            <Section icon="lungs" color={Colors.oxygen} title="3. El oído de los pulmones">
              <Text style={styles.p}>
                {lungCnn
                  ? 'Redes neuronales entrenadas con la base ICBHI 2017 (126 pacientes). Igual que en el corazón, solo se muestra lo que acierta de forma confiable:'
                  : 'Las redes neuronales de pulmón están listas, pero aún se están entrenando con la base ICBHI 2017.'}
              </Text>
              {lungCnn &&
                ['crepitantes', 'sibilancias'].map((k) => {
                  const raw = lung?.lung_sounds_cnn?.metricas_prueba?.[k];
                  if (!raw) return null;
                  const mm = raw.grabacion_completa || raw;  // métricas por grabación completa si existen
                  return (
                    <View key={k} style={styles.traitRow}>
                      <Ionicons
                        name={mm.mostrar ? 'checkmark-circle' : 'eye-off-outline'}
                        size={15}
                        color={mm.mostrar ? Colors.success : Colors.textMuted}
                      />
                      <Text style={[styles.traitText, !mm.mostrar && { color: Colors.textMuted }]}>
                        {k.charAt(0).toUpperCase() + k.slice(1)}: detecta {pct(mm.sensibilidad)}, reconoce normales {pct(mm.especificidad)}
                        {mm.mostrar ? '' : ' · no se muestra (poco confiable)'}
                      </Text>
                    </View>
                  );
                })}
              {lungCnn && lung?.lung_disease_cnn?.loaded && !lung.lung_disease_cnn.mostrar && (
                <Text style={styles.small}>
                  El patrón por enfermedad (EPOC, neumonía…) no se muestra: con tan pocos pacientes por enfermedad no es confiable.
                </Text>
              )}
              {base?.loaded && (
                <Text style={styles.p}>
                  También hay un <Text style={styles.b}>modelo base</Text> (regresión logística) hecho por el equipo, que
                  dice normal o patológico. Verificado con 24 pacientes no vistos: detecta el 90 % de los ciclos anormales,
                  pero marca como anormales a 7 de cada 10 normales.
                  {base.extractor_listo
                    ? ' Ya analiza grabaciones del dispositivo.'
                    : ' Por eso solo se usa en los casos de demostración.'}
                </Text>
              )}
            </Section>

            <Section icon="traffic-light" color={Colors.warning} title="4. Las reglas: el semáforo">
              <Text style={styles.p}>No es inteligencia artificial: son reglas fijas, fáciles de revisar.</Text>
              <Bullet color={Colors.danger} text="ROJO: un síntoma de alarma (dificultad intensa para respirar, labios azulados, confusión, desmayo o dolor de pecho) u oxígeno calibrado menor a 90 %." />
              <Bullet color={Colors.warning} text="AMARILLO: sonido del corazón o de los pulmones anormal, síntomas comunicados, oxígeno calibrado menor a 94 % o pulso fuera de 45–120 en un adulto en reposo." />
              <Bullet color={Colors.textSecondary} text="GRIS: faltan datos. Sin oxígeno calibrado todavía no se puede llegar a VERDE." />
              <Bullet color={Colors.success} text="VERDE: sin hallazgos y sin datos faltantes." />
            </Section>

            <Section icon="robot-outline" color={Colors.primary} title="5. La voz: el asistente (Qwen)">
              <Text style={styles.p}>
                Un modelo de lenguaje que corre en la propia Mac, sin internet, responde preguntas, redacta el texto de las
                alertas y un resumen sencillo del informe (las secciones clínicas del informe salen de las reglas). Solo usa
                los datos medidos; si escribe una cifra que no está en los datos, su texto se descarta. Se revisa con una
                prueba de preguntas trampa.
              </Text>
            </Section>

            <Section icon="alert-circle-outline" color={Colors.textSecondary} title="Lo que todavía NO hace">
              <Bullet color={Colors.textMuted} text="No diagnostica enfermedades: sugiere a quién referir." />
              <Bullet color={Colors.textMuted} text="No se ha probado con pacientes reales, solo con bases públicas." />
              <Bullet color={Colors.textMuted} text="No mide presión arterial ni temperatura." />
              <Bullet color={Colors.textMuted} text="Falta ajustar la IA al sonido de nuestro estetoscopio (corrección acústica con el fantoma)." />
            </Section>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const Section: React.FC<{ icon: string; color: string; title: string; children: React.ReactNode }> = ({
  icon, color, title, children,
}) => (
  <View style={styles.section}>
    <View style={styles.sectionHeader}>
      <MaterialCommunityIcons name={icon as any} size={18} color={color} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
    {children}
  </View>
);

const Stat: React.FC<{ value: string; label: string }> = ({ value, label }) => (
  <View style={styles.stat}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const Bullet: React.FC<{ color: string; text: string }> = ({ color, text }) => (
  <View style={styles.bullet}>
    <View style={[styles.dot, { backgroundColor: color }]} />
    <Text style={styles.bulletText}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '92%',
    padding: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: Colors.textPrimary },
  close: { padding: 6 },
  lead: { fontSize: 14, color: Colors.textPrimary, lineHeight: 21, marginBottom: 12 },
  b: { fontWeight: '800' },
  warn: { fontSize: 12, color: Colors.danger, marginBottom: 10 },
  section: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 10,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: Colors.textPrimary },
  p: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 6 },
  small: { fontSize: 11, color: Colors.textMuted, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  stat: { flex: 1, backgroundColor: Colors.backgroundSecondary, borderRadius: 10, padding: 10 },
  statValue: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary },
  statLabel: { fontSize: 11, color: Colors.textSecondary, lineHeight: 15 },
  traitRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  traitText: { flex: 1, fontSize: 12, color: Colors.textPrimary },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
  bulletText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
});
