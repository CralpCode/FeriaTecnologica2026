import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Text } from '../components/ui/Text';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useVitals } from '../context/VitalsContext';
import { AIExplainerModal } from '../components/AIExplainerModal';
import { BloodOxygenReading, MicrophoneLevel } from '../components/SensorReadouts';
import { useDisplayedMeasurements } from '../hooks/useDisplayedMeasurements';

export const AIAssistantScreen: React.FC = () => {
  const { vitals, currentSessionId, connectedType, chatMessages, isChatLoading, sendChatMessage } = useVitals();
  const { readings } = useDisplayedMeasurements(vitals, `${currentSessionId}:${connectedType}`);
  const pulse = readings.heartRate;
  const oxygen = readings.bloodOxygen;
  const prv = readings.hrv;
  const audio = readings.audio_rms;
  const stress = readings.experimentalStressScore;
  const retained = (reading?: { state: string }) => reading?.state === 'held' ? 'Última lectura válida; esperando señal' : undefined;
  const [inputText, setInputText] = useState('');
  const [showExplainer, setShowExplainer] = useState(false);
  const scrollViewRef = useRef<any>(null);

  const suggestions = [
    '¿Cómo están mis pulsaciones actuales?',
    '¿Hay datos de oxígeno (SpO2)?',
    '¿Qué resultado dio la auscultación?',
    '¿Detectas ruidos pulmonares o sibilancias en mi auscultación?',
    'Resume esta sesión en pocas palabras',
    '¿Qué es SpiroScan y cómo funciona?',
  ];

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [chatMessages, isChatLoading]);

  const handleSend = () => {
    if (!inputText.trim()) return;
    const text = inputText;
    setInputText('');
    sendChatMessage(text);
  };

  const handleSuggestionPress = (prompt: string) => {
    sendChatMessage(prompt);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      style={styles.container}
    >
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={true}
      >
        <TouchableOpacity style={styles.explainerBtn} onPress={() => setShowExplainer(true)} activeOpacity={0.8}>
          <MaterialCommunityIcons name="brain" size={18} color={Colors.aiPurple} />
          <Text style={styles.explainerText}>¿Cómo funciona la IA de SpiroScan?</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.aiPurple} />
        </TouchableOpacity>
        <AIExplainerModal visible={showExplainer} onClose={() => setShowExplainer(false)} />

        {/* Lecturas en vivo: solo valores válidos (lo demás dice por qué no hay dato) */}
        <View style={styles.liveVitalsBanner}>
          <View style={styles.bannerHeaderRow}>
            <View style={styles.bannerTitleGroup}>
              <MaterialCommunityIcons name="heart-pulse" size={16} color={Colors.primary} />
              <Text style={styles.bannerHeaderTitle}>LECTURAS EN VIVO</Text>
            </View>
            <View style={styles.llamaStatusBadge}>
              <MaterialCommunityIcons name="brain" size={13} color={Colors.success} />
              <Text style={styles.llamaStatusText}>IA del servidor</Text>
            </View>
          </View>
          <View style={styles.vitalsGrid}>
            <LiveValue icon="heart" tint={Colors.heartRate} label="Pulso"
                       value={pulse ? `${Math.round(pulse.value)} BPM` : 'Sin lectura válida'} hint={retained(pulse)} />
            <BloodOxygenReading reading={oxygen} vitals={vitals} />
            <LiveValue icon="pulse" tint={Colors.stress} label="Variabilidad (PRV)"
                       value={prv ? `${prv.value} ms` : 'Reuniendo intervalos'} hint={retained(prv) ?? 'Intervalos ópticos; no es ECG'} />
            <LiveValue icon="sparkles" tint={Colors.stress} label="Estrés experimental"
                       value={stress ? `${stress.value}/100` : 'Sin estimación'} hint={retained(stress) ?? 'Regla por PRV; no validada clínicamente'} />
            <MicrophoneLevel reading={audio} />
          </View>
        </View>

        {/* Historial de Mensajes */}
        {chatMessages.map((msg) => (
          <View
            key={msg.id}
            style={[
              styles.messageBubble,
              msg.sender === 'user' ? styles.userBubble : styles.aiBubble,
            ]}
          >
            {msg.sender === 'ai' && (
              <View style={styles.aiAvatar}>
                <MaterialCommunityIcons name="robot" size={16} color={Colors.primary} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text
                selectable={true}
                style={[
                  styles.messageText,
                  msg.sender === 'user' ? styles.userMessageText : styles.aiMessageText,
                ]}
              >
                {msg.text}
              </Text>
              <Text
                style={[
                  styles.timestampText,
                  msg.sender === 'user' ? styles.userTimestamp : styles.aiTimestamp,
                ]}
              >
                {msg.timestamp}
              </Text>
            </View>
          </View>
        ))}

        {/* Indicador mientras responde el modelo de lenguaje */}
        {isChatLoading && (
          <View style={[styles.messageBubble, styles.aiBubble, { paddingVertical: 10, alignItems: 'center' }]}>
            <View style={styles.aiAvatar}>
              <MaterialCommunityIcons name="robot-excited" size={16} color={Colors.primary} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={{ fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic', flexShrink: 1 }}>
                El asistente está redactando la respuesta…
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Sugerencias Rápidas */}
      <View style={styles.suggestionsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionsScroll}>
          {suggestions.map((item, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.suggestionChip}
              onPress={() => handleSuggestionPress(item)}
              activeOpacity={0.7}
            >
              <Text style={styles.suggestionText}>{item}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Barra de Entrada de Texto */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Pregúntale al asistente sobre tus datos o sobre SpiroScan…"
          placeholderTextColor={Colors.textMuted}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          onKeyPress={(e: any) => {
            // En computadora: Enter envía y Shift+Enter hace salto de línea
            if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
              e.preventDefault?.();
              handleSend();
            }
          }}
          accessibilityLabel="Mensaje para el asistente"
          returnKeyType="send"
          multiline={true}
        />
        <TouchableOpacity
          style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim() || isChatLoading}
        >
          <Ionicons name="send" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const LiveValue: React.FC<{ icon: React.ComponentProps<typeof Ionicons>['name']; tint: string; label: string; value: string; hint?: string }> = ({
  icon, tint, label, value, hint,
}) => (
  <View style={styles.vitalGridCard}>
    <View style={[styles.vitalIconWrap, { backgroundColor: `${tint}14` }]}>
      <Ionicons name={icon} size={14} color={tint} />
    </View>
    <View style={styles.vitalCardContent}>
      <Text style={styles.vitalCardLabel}>{label}</Text>
      <Text style={styles.vitalCardValue} numberOfLines={1}>{value}</Text>
      {hint && <Text style={styles.vitalCardHint}>{hint}</Text>}
    </View>
  </View>
);

const styles = StyleSheet.create({
  explainerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.aiPurpleSoft,
    borderColor: '#DDD6FE',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  explainerText: { flex: 1, fontSize: 14, fontWeight: '800', color: Colors.aiPurple },
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 14,
    paddingBottom: 24,
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
  },
  liveVitalsBanner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  bannerHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  bannerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  bannerHeaderTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
    letterSpacing: 0.6,
  },
  llamaStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 4,
  },
  llamaStatusText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#15803D',
  },
  vitalsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  vitalGridCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    width: '48.5%',
    minWidth: 135,
    flexGrow: 1,
  },
  vitalIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  vitalCardContent: {
    flex: 1,
    justifyContent: 'center',
  },
  vitalCardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 1,
  },
  vitalCardValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  vitalCardHint: { fontSize: 11, color: '#64748B', marginTop: 3 },
  messageBubble: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 18,
    marginBottom: 12,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
    maxWidth: '85%',
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderBottomLeftRadius: 4,
    maxWidth: '92%',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  aiAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 22,
  },
  userMessageText: {
    color: '#FFFFFF',
    fontWeight: '500',
  },
  aiMessageText: {
    color: '#1E293B',
  },
  timestampText: {
    fontSize: 12,
    marginTop: 8,
  },
  userTimestamp: {
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'right',
  },
  aiTimestamp: {
    color: Colors.textMuted,
    textAlign: 'left',
  },
  suggestionsContainer: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  suggestionsScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  suggestionChip: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  suggestionText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '600',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#CBD5E1',
  },
});
