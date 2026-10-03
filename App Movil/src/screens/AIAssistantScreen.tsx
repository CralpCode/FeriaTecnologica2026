import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useVitals } from '../context/VitalsContext';

export const AIAssistantScreen: React.FC = () => {
  const { vitals, chatMessages, isChatLoading, sendChatMessage } = useVitals();
  const [inputText, setInputText] = useState('');
  const scrollViewRef = useRef<any>(null);

  const suggestions = [
    '¿Cómo están mis pulsaciones actuales?',
    '¿Mi oxigenación SpO2 es normal?',
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
        {/* Banner Superior de Estado en Vivo (Grid Adaptativo 2x2 Antidesbordamiento) */}
        <View style={styles.liveVitalsBanner}>
          <View style={styles.bannerHeaderRow}>
            <View style={styles.bannerTitleGroup}>
              <MaterialCommunityIcons name="heart-pulse" size={16} color={Colors.primary} />
              <Text style={styles.bannerHeaderTitle}>TELEMETRÍA EN TIEMPO REAL</Text>
            </View>
            <View style={styles.llamaStatusBadge}>
              <MaterialCommunityIcons name="brain" size={13} color="#15803D" />
              <Text style={styles.llamaStatusText}>LLaMA 3.2 Docker</Text>
            </View>
          </View>

          <View style={styles.vitalsGrid}>
            {/* Ritmo Cardíaco */}
            <View style={styles.vitalGridCard}>
              <View style={[styles.vitalIconWrap, { backgroundColor: '#FFE4E6' }]}>
                <Ionicons name="heart" size={14} color="#E11D48" />
              </View>
              <View style={styles.vitalCardContent}>
                <Text style={styles.vitalCardLabel}>Pulsaciones</Text>
                <Text style={styles.vitalCardValue} numberOfLines={1}>
                  {vitals.heartRate > 0 ? `${vitals.heartRate} LPM` : 'En espera'}
                </Text>
              </View>
            </View>

            {/* Oxígeno SpO2 */}
            <View style={styles.vitalGridCard}>
              <View style={[styles.vitalIconWrap, { backgroundColor: '#E0F2FE' }]}>
                <Ionicons name="water" size={14} color="#0EA5E9" />
              </View>
              <View style={styles.vitalCardContent}>
                <Text style={styles.vitalCardLabel}>Oxígeno SpO2</Text>
                <Text style={styles.vitalCardValue} numberOfLines={1}>
                  {vitals.bloodOxygen > 0 ? `${vitals.bloodOxygen.toFixed(1)}%` : 'En espera'}
                </Text>
              </View>
            </View>

            {/* Variabilidad HRV */}
            <View style={styles.vitalGridCard}>
              <View style={[styles.vitalIconWrap, { backgroundColor: '#EDE9FE' }]}>
                <Ionicons name="pulse" size={14} color="#8B5CF6" />
              </View>
              <View style={styles.vitalCardContent}>
                <Text style={styles.vitalCardLabel}>HRV</Text>
                <Text style={styles.vitalCardValue} numberOfLines={1}>
                  {vitals.hrv > 0 ? `${vitals.hrv} ms` : 'En espera'}
                </Text>
              </View>
            </View>

            {/* Bio-Acústica */}
            <View style={styles.vitalGridCard}>
              <View style={[styles.vitalIconWrap, { backgroundColor: '#ECFDF5' }]}>
                <MaterialCommunityIcons name="microphone" size={14} color="#10B981" />
              </View>
              <View style={styles.vitalCardContent}>
                <Text style={styles.vitalCardLabel}>Bio-Acústica</Text>
                <Text style={styles.vitalCardValue} numberOfLines={1}>
                  {vitals.audio_rms > 0 ? `${vitals.audio_rms.toFixed(1)} dB` : 'Silencio'}
                </Text>
              </View>
            </View>
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

        {/* Indicador de Inferencia en Docker */}
        {isChatLoading && (
          <View style={[styles.messageBubble, styles.aiBubble, { paddingVertical: 10, alignItems: 'center' }]}>
            <View style={styles.aiAvatar}>
              <MaterialCommunityIcons name="robot-excited" size={16} color={Colors.primary} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={{ fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic', flexShrink: 1 }}>
                Generando respuesta médica completa con LLaMA 3.2 en Docker...
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
          placeholder="Pregúntale a tu Asistente Médico..."
          placeholderTextColor={Colors.textMuted}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
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

const styles = StyleSheet.create({
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
    fontSize: 11,
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
    fontSize: 10,
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
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 1,
  },
  vitalCardValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
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
    fontSize: 10,
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
