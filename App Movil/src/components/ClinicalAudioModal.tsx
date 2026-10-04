import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useModalLayout } from '../hooks/useLayout';
import { apiService } from '../services/api';
import { useVitals } from '../context/VitalsContext';
import localDemoSamples from '../config/demoSamples.json';
import { DEMO_AUDIO_BASE64 } from '../config/demoAudioBase64';

interface ClinicalAudioModalProps {
  visible: boolean;
  onClose: () => void;
}

interface DemoSampleInfo {
  id: string;
  name: string;
  patient_id: number;
  diagnosis: string;
  sound_type: string;
  is_abnormal: number;
  duration: string;
  description: string;
  clinical_tip: string;
  color: string;
  softColor: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}

const DEMO_CASES: DemoSampleInfo[] = [
  {
    id: 'sano',
    name: 'Sano (sin ruidos agregados)',
    patient_id: 159,
    diagnosis: 'Sano (etiqueta ICBHI: Healthy)',
    sound_type: 'Ciclo normal (sin crepitantes ni sibilancias)',
    is_abnormal: 0,
    duration: '6.0s',
    description: 'Murmullo vesicular: sonido respiratorio suave, sin ruidos agregados.',
    clinical_tip: 'Referencia de un caso sin hallazgos: compara lo que dice el modelo con la etiqueta real de ICBHI.',
    color: '#10B981',
    softColor: '#ECFDF5',
    icon: 'lungs',
  },
  {
    id: 'sibilancias',
    name: 'Sibilancias (Wheezes)',
    patient_id: 104,
    diagnosis: 'EPOC (etiqueta ICBHI: COPD)',
    sound_type: 'Ciclo con sibilancias (Wheezes)',
    is_abnormal: 1,
    duration: '6.0s',
    description: 'Sibilancias: sonido musical continuo y agudo, típico de vías aéreas estrechadas.',
    clinical_tip: 'El modelo base estima si el ciclo es patológico; el asistente lo explica sin diagnosticar ni recomendar medicamentos.',
    color: '#F59E0B',
    softColor: '#FFFBEB',
    icon: 'weather-windy',
  },
  {
    id: 'crepitantes',
    name: 'Estertores Crepitantes (Crackles)',
    patient_id: 157,
    diagnosis: 'EPOC (etiqueta ICBHI: COPD)',
    sound_type: 'Ciclo con crepitantes (Crackles)',
    is_abnormal: 1,
    duration: '6.0s',
    description: 'Crepitantes: sonidos breves y discontinuos, como chasquidos, durante la respiración.',
    clinical_tip: 'Si el modelo lo marca patológico, se genera una alerta pulmonar y cambia el semáforo de triaje.',
    color: '#EF4444',
    softColor: '#FEF2F2',
    icon: 'water-alert',
  },
  {
    id: 'ambos',
    name: 'Sibilancias y crepitantes',
    patient_id: 130,
    diagnosis: 'EPOC (etiqueta ICBHI: COPD)',
    sound_type: 'Ciclo con sibilancias y crepitantes (Both)',
    is_abnormal: 1,
    duration: '6.0s',
    description: 'Ciclo con ambos tipos de ruido agregado: sibilancias y crepitantes.',
    clinical_tip: 'Si el modelo lo marca patológico, el semáforo de la sesión lo muestra marcado como DEMO: no es de la persona.',
    color: '#8B5CF6',
    softColor: '#F5F3FF',
    icon: 'alert-octagon',
  },
  {
    id: 'neumonia',
    name: 'Neumonía (etiqueta ICBHI)',
    patient_id: 140,
    diagnosis: 'Neumonía (etiqueta ICBHI: Pneumonia)',
    sound_type: 'Ciclo con crepitantes (Crackles)',
    is_abnormal: 1,
    duration: '6.0s',
    description: 'Grabación de un paciente con neumonía según ICBHI; el ciclo tiene crepitantes.',
    clinical_tip: 'El modelo base solo dice normal o patológico; no identifica la enfermedad.',
    color: '#DC2626',
    softColor: '#FEF2F2',
    icon: 'biohazard',
  },
];

export const ClinicalAudioModal: React.FC<ClinicalAudioModalProps> = ({ visible, onClose }) => {
  const modal = useModalLayout();
  const { currentSessionId, injectClinicalDemo } = useVitals();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [injectingId, setInjectingId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Parar el audio al cerrar el modal
  useEffect(() => {
    if (!visible && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlayingId(null);
    }
  }, [visible]);

  const handlePlayToggle = (sampleId: string) => {
    if (playingId === sampleId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setPlayingId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    // Audio normalizado e incrustado en Base64 (0ms latencia, independiente de red)
    const audioSrc = DEMO_AUDIO_BASE64[sampleId] || apiService.getDemoAudioUrl(sampleId);

    if (typeof window !== 'undefined' && (window as any).Audio) {
      try {
        const audio = new (window as any).Audio(audioSrc);
        audioRef.current = audio;
        audio.volume = 1.0;
        audio.onended = () => setPlayingId(null);
        audio.onerror = (e: any) => {
          console.warn('Error de reproducción de audio torácico:', e);
          setPlayingId(null);
        };
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              setPlayingId(sampleId);
            })
            .catch((err: any) => {
              console.warn('Reproducción de audio rechazada por política del navegador:', err);
              setPlayingId(null);
            });
        } else {
          setPlayingId(sampleId);
        }
      } catch (err) {
        console.warn('Excepción al reproducir audio torácico:', err);
        setPlayingId(null);
      }
    } else {
      // Simulación en entornos sin Audio nativo
      setPlayingId(sampleId);
      setTimeout(() => setPlayingId(null), 6000);
    }
  };

  const handleInjectSample = async (sample: DemoSampleInfo) => {
    setInjectingId(sample.id);
    setSuccessMessage(null);

    try {
      // Cargar el caso en la sesión actual: análisis REAL del modelo base en el servidor, marcado como demostración
      await injectClinicalDemo(sample.id);

      setSuccessMessage(
        `Caso del paciente ICBHI #${sample.patient_id} (${sample.name}) cargado en la sesión actual como demostración.\n${sample.sound_type}`
      );
    } catch {
      setSuccessMessage('No se pudo inyectar la muestra.');
    } finally {
      setInjectingId(null);
    }
  };

  return (
    <Modal visible={visible} animationType={modal.animationType} transparent onRequestClose={onClose}>
      <View style={[styles.modalOverlay, modal.overlay]}>
        <View style={[styles.modalContent, modal.sheet]}>
          {/* Cabecera del Banco de Pruebas */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={styles.labIconBadge}>
                <MaterialCommunityIcons name="flask-outline" size={22} color={Colors.aiPurple} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.tagRow}>
                  <Text style={styles.headerTag}>BANCO DE PRUEBAS CLÍNICAS</Text>
                  <View style={styles.icbhiBadge}>
                    <Text style={styles.icbhiBadgeText}>ICBHI 2017</Text>
                  </View>
                </View>
                <Text style={styles.headerTitle}>Validación de Auscultación</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Banner Didáctico */}
          <View style={styles.infoBanner}>
            <MaterialCommunityIcons name="information" size={16} color={Colors.primary} style={{ marginRight: 6 }} />
            <Text style={styles.infoBannerText}>
              Grabaciones reales de otras personas (ICBHI 2017). Puedes escucharlas o analizarlas con el modelo base; el resultado queda marcado como DEMO en el paciente abierto.
            </Text>
          </View>

          {/* Mensaje de confirmación con acceso directo a Pantalla Principal */}
          {successMessage && (
            <View style={styles.successToast}>
              <View style={styles.successToastHeader}>
                <Ionicons name="checkmark-circle" size={18} color="#059669" style={{ marginRight: 6 }} />
                <Text style={styles.successToastTitle}>¡Señales Inyectadas con Éxito!</Text>
              </View>
              <Text style={styles.successToastText}>{successMessage}</Text>
              <TouchableOpacity
                style={styles.goToMainBtn}
                onPress={() => {
                  if (audioRef.current) {
                    audioRef.current.pause();
                    audioRef.current.currentTime = 0;
                    setPlayingId(null);
                  }
                  onClose();
                }}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="monitor-dashboard" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.goToMainBtnText}>Ver en Pantalla Principal</Text>
                <Ionicons name="arrow-forward" size={14} color="#FFFFFF" style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            </View>
          )}

          {/* Lista de Casos de Validación */}
          <ScrollView style={styles.scrollList} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={true}>
            {DEMO_CASES.map((item) => {
              const isPlaying = playingId === item.id;
              const isInjecting = injectingId === item.id;

              return (
                <View key={item.id} style={[styles.sampleCard, { borderLeftColor: item.color }]}>
                  {/* Encabezado de la Tarjeta */}
                  <View style={styles.cardHeader}>
                    <View style={styles.cardTitleWrap}>
                      <View style={[styles.cardIconWrap, { backgroundColor: item.softColor }]}>
                        <MaterialCommunityIcons name={item.icon} size={20} color={item.color} />
                      </View>
                      <View>
                        <Text style={styles.cardTitle}>{item.name}</Text>
                        <Text style={styles.cardSub}>Paciente #{item.patient_id} • {item.diagnosis}</Text>
                      </View>
                    </View>
                    <View style={[styles.badgePill, { backgroundColor: item.is_abnormal ? '#FEE2E2' : '#DCFCE7' }]}>
                      <Text style={[styles.badgePillText, { color: item.is_abnormal ? '#B91C1C' : '#15803D' }]}>
                        {item.is_abnormal ? 'PATOLÓGICO' : 'NORMAL'}
                      </Text>
                    </View>
                  </View>

                  {/* Descripción acústica y médica */}
                  <Text style={styles.descriptionText}>{item.description}</Text>

                  <View style={styles.metricsRow}>
                    <View style={styles.metricPill}>
                      <Ionicons name="time-outline" size={13} color="#64748B" />
                      <Text style={styles.metricPillText}>Ciclo de {item.duration}</Text>
                    </View>
                  </View>

                  {/* Tip clínico para la feria */}
                  <View style={styles.tipBox}>
                    <Ionicons name="bulb-outline" size={13} color="#D97706" style={{ marginRight: 5, marginTop: 1 }} />
                    <Text style={styles.tipText}>{item.clinical_tip}</Text>
                  </View>

                  {/* Banner de Reproducción Activa */}
                  {isPlaying && (
                    <View style={[styles.playingBanner, { backgroundColor: item.softColor, borderColor: item.color }]}>
                      <MaterialCommunityIcons name="waveform" size={16} color={item.color} style={{ marginRight: 6 }} />
                      <Text style={[styles.playingBannerText, { color: item.color }]}>
                        Reproduciendo auscultación torácica del Paciente #{item.patient_id} ({item.duration})...
                      </Text>
                    </View>
                  )}

                  {/* Botones de Acción */}
                  <View style={styles.actionsRow}>
                    {/* Botón Reproducir / Pausar Audio */}
                    <TouchableOpacity
                      style={[styles.playButton, isPlaying && styles.playButtonActive]}
                      onPress={() => handlePlayToggle(item.id)}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={isPlaying ? 'pause' : 'volume-high'}
                        size={16}
                        color={isPlaying ? '#FFFFFF' : Colors.primary}
                        style={{ marginRight: 6 }}
                      />
                      <Text style={[styles.playButtonText, isPlaying && { color: '#FFFFFF' }]}>
                        {isPlaying ? 'Pausar Audio' : 'Escuchar Tórax'}
                      </Text>
                    </TouchableOpacity>

                    {/* Botón Inyectar en Demostración */}
                    <TouchableOpacity
                      style={[styles.injectButton, { backgroundColor: item.color }]}
                      onPress={() => handleInjectSample(item)}
                      activeOpacity={0.85}
                      disabled={isInjecting}
                    >
                      {isInjecting ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <MaterialCommunityIcons name="lightning-bolt" size={16} color="#FFFFFF" style={{ marginRight: 5 }} />
                          <Text style={styles.injectButtonText}>Analizar como DEMO</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* Pie del modal */}
          <View style={styles.footer}>
            <Text style={styles.footerSessionText}>
              Sesión activa: <Text style={{ fontWeight: '700', color: Colors.primary }}>{currentSessionId}</Text>
            </Text>
            <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>Cerrar Banco</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    width: '100%',
    maxWidth: 580,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 8,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  labIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#F3E8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  headerTag: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.aiPurple,
    letterSpacing: 0.5,
  },
  icbhiBadge: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  icbhiBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.aiPurple,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#DBEAFE',
  },
  infoBannerText: {
    fontSize: 12,
    color: '#1E40AF',
    flex: 1,
    lineHeight: 16,
  },
  successToast: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  successToastHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  successToastTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#065F46',
  },
  successToastText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#047857',
    lineHeight: 16,
    marginBottom: 10,
  },
  goToMainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  goToMainBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scrollList: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 14,
  },
  sampleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  cardIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  cardSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  badgePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgePillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  descriptionText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 17,
    marginBottom: 10,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  metricPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  metricPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  tipBox: {
    flexDirection: 'row',
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    marginBottom: 12,
  },
  tipText: {
    fontSize: 12,
    color: '#92400E',
    flex: 1,
    lineHeight: 15,
  },
  playingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 12,
  },
  playingBannerText: {
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
    lineHeight: 15,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  playButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  playButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  playButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  injectButton: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 9,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  injectButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#F8FAFC',
  },
  footerSessionText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  doneBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  doneBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
});
