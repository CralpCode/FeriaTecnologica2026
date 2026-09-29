import { VitalSigns, AIAnalysisReport, VitalStatus, ChatMessage } from '../types/vitals';

/**
 * Motor de Diagnóstico y Análisis con IA en Tiempo Real
 * Simula el modelo de Inteligencia Artificial que correrá en el backend.
 */
export const analyzeVitalsLocally = (vitals: VitalSigns): AIAnalysisReport => {
  const anomalies: string[] = [];
  const recommendations: string[] = [];
  let status: VitalStatus = 'normal';
  let penalty = 0;

  // 1. Análisis de Ritmo Cardíaco
  if (vitals.heartRate > 110) {
    status = 'critical';
    penalty += 35;
    anomalies.push(`Taquicardia pronunciada detectada (${vitals.heartRate} BPM en reposo).`);
    recommendations.push('Detén cualquier actividad física vigorosa y permanece sentado en un ambiente fresco.');
    recommendations.push('Practica respiración diafragmática (4 segundos inhalar, 4 exhalar).');
  } else if (vitals.heartRate > 95) {
    status = 'caution';
    penalty += 15;
    anomalies.push(`Frecuencia cardíaca ligeramente elevada (${vitals.heartRate} BPM).`);
    recommendations.push('Asegúrate de mantener una adecuada hidratación con agua.');
  } else if (vitals.heartRate < 55) {
    status = 'caution';
    penalty += 15;
    anomalies.push(`Bradicardia leve observada (${vitals.heartRate} BPM).`);
  }

  // 2. Análisis de Saturación de Oxígeno (SpO2)
  if (vitals.bloodOxygen < 92) {
    status = 'critical';
    penalty += 40;
    anomalies.push(`Hipoxemia moderada/severa (${vitals.bloodOxygen}% SpO2). Nivel de oxígeno en sangre bajo.`);
    recommendations.push('Ventila el espacio inmediatamente o sal al aire libre.');
    recommendations.push('Si sientes mareo o dificultad para respirar, consulta a un profesional de la salud de urgencia.');
  } else if (vitals.bloodOxygen < 95) {
    if (status === 'normal') status = 'caution';
    penalty += 20;
    anomalies.push(`Saturación de oxígeno por debajo del rango óptimo (${vitals.bloodOxygen}%).`);
    recommendations.push('Realiza respiraciones profundas durante 3 minutos y mantén una postura erguida.');
  }

  // 3. Análisis de Presión Arterial
  if (vitals.systolicPressure >= 140 || vitals.diastolicPressure >= 90) {
    status = 'critical';
    penalty += 30;
    anomalies.push(`Lectura de Hipertensión Estadio 2 (${vitals.systolicPressure}/${vitals.diastolicPressure} mmHg).`);
    recommendations.push('Evita el consumo de sal, cafeína o bebidas estimulantes.');
    recommendations.push('Monitorea tu presión en 15 minutos tras reposo absoluto.');
  } else if (vitals.systolicPressure >= 130 || vitals.diastolicPressure >= 85) {
    if (status === 'normal') status = 'caution';
    penalty += 15;
    anomalies.push(`Presión arterial elevada (${vitals.systolicPressure}/${vitals.diastolicPressure} mmHg).`);
    recommendations.push('Toma una pausa de descanso de pantalla y reduce la tensión muscular.');
  }

  // 4. Análisis de Estrés y Variabilidad Cardíaca (HRV)
  if (vitals.stressLevel > 70 || vitals.hrv < 30) {
    if (status === 'normal') status = 'caution';
    penalty += 12;
    anomalies.push(`Sobrecarga de estrés fisiológico detectada (Índice ${vitals.stressLevel}/100, HRV ${vitals.hrv}ms).`);
    recommendations.push('Tu sistema nervioso autónomo refleja tensión. Sugerimos una pausa activa de 5 minutos.');
  }

  // 5. Temperatura corporal
  if (vitals.temperature >= 37.8) {
    if (status !== 'critical') status = 'caution';
    penalty += 20;
    anomalies.push(`Temperatura corporal elevada (${vitals.temperature}°C - Febrícula/Fiebre).`);
    recommendations.push('Monitorea tu temperatura corporal e hidrátate constantemente.');
  }

  // Si todo está bien
  if (anomalies.length === 0) {
    recommendations.push('Todos tus parámetros biométricos se encuentran en rangos clínicos saludables.');
    recommendations.push('Mantén tu ritmo de hidratación y actividad física diaria.');
  }

  const healthScore = Math.max(25, Math.min(99, 100 - penalty));

  let title = 'Signos Vitales Óptimos y Estables';
  let summary = `La IA analizó tus biosensores en tiempo real. Ritmo cardíaco (${vitals.heartRate} BPM) y Oxigenación (${vitals.bloodOxygen}%) presentan una función cardiopulmonar eficiente y balanceada.`;

  if (status === 'critical') {
    title = 'Alerta Médica: Anomalías Relevantes Detectadas';
    summary = `El modelo neuronal detectó combinaciones biométricas fuera de umbrales seguros: ${anomalies[0]} Es imperativo tomar precauciones de descanso inmediato.`;
  } else if (status === 'caution') {
    title = 'Atención Preventiva: Desviación Ligera';
    summary = `El modelo detectó una desviación respecto a tu línea base habitual: ${anomalies[0]} Aplica las recomendaciones sugeridas para restablecer el equilibrio.`;
  }

  return {
    id: `ai-report-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    healthScore,
    status,
    title,
    summary,
    recommendations,
    anomaliesDetected: anomalies,
    confidence: Math.round(94 + Math.random() * 5),
  };
};

/**
 * Respuestas interactivas contextuales del Asistente de Salud IA
 */
export const generateAIChatResponse = (userPrompt: string, currentVitals: VitalSigns): string => {
  const promptLower = userPrompt.toLowerCase();

  if (promptLower.includes('oxigeno') || promptLower.includes('oxígeno') || promptLower.includes('spo2')) {
    return `Tu nivel de oxígeno en sangre actual es de ${currentVitals.bloodOxygen}%. ${
      currentVitals.bloodOxygen >= 95
        ? 'Es un nivel excelente y seguro para la oxigenación celular.'
        : 'Está ligeramente bajo; te sugiero realizar 5 respiraciones lentas y profundas con el pecho expandido.'
    }`;
  }

  if (promptLower.includes('presion') || promptLower.includes('presión') || promptLower.includes('arterial')) {
    return `Tu presión arterial registrada es ${currentVitals.systolicPressure}/${currentVitals.diastolicPressure} mmHg. ${
      currentVitals.systolicPressure < 125 && currentVitals.diastolicPressure < 82
        ? 'Se encuentra en la categoría Normal según los estándares de la American Heart Association.'
        : 'Muestra una ligera elevación. Evita estimulantes como cafeína o sodio y descansa unos minutos.'
    }`;
  }

  if (promptLower.includes('pulsaciones') || promptLower.includes('corazon') || promptLower.includes('corazón') || promptLower.includes('ritmo') || promptLower.includes('bpm')) {
    return `Tu frecuencia cardíaca actual es de ${currentVitals.heartRate} BPM con una variabilidad (HRV) de ${currentVitals.hrv} ms. ${
      currentVitals.heartRate > 100
        ? 'Estás experimentando pulsaciones aceleradas (taquicardia). Te sugiero reposar y beber agua.'
        : 'Tu ritmo se mantiene dentro del rango normal en reposo (60-100 BPM).'
    }`;
  }

  if (promptLower.includes('estres') || promptLower.includes('estrés') || promptLower.includes('ansiedad')) {
    return `Tu nivel de estrés fisiológico calculado es de ${currentVitals.stressLevel}/100. ${
      currentVitals.stressLevel > 60
        ? 'Se detecta una sobrecarga del sistema simpático. Te recomiendo una breve pausa activa de relajación guiada.'
        : 'Tus biomarcadores muestran que te encuentras en un estado de calma relativa.'
    }`;
  }

  if (promptLower.includes('resumen') || promptLower.includes('estado') || promptLower.includes('como estoy') || promptLower.includes('cómo estoy')) {
    return `Aquí tienes tu estado general al instante: Pulso: ${currentVitals.heartRate} BPM, Oxígeno: ${currentVitals.bloodOxygen}%, Presión: ${currentVitals.systolicPressure}/${currentVitals.diastolicPressure} mmHg, Temperatura: ${currentVitals.temperature}°C y Estrés: ${currentVitals.stressLevel}%. En general, tus sensores indican un estado ${currentVitals.heartRate > 100 || currentVitals.bloodOxygen < 94 ? 'de precaución' : 'estable y controlado'}.`;
  }

  return `Entendido. Estoy analizando continuamente tus biosensores (${currentVitals.heartRate} BPM, ${currentVitals.bloodOxygen}% SpO2, ${currentVitals.systolicPressure}/${currentVitals.diastolicPressure} mmHg). Puedes preguntarme por tu ritmo cardíaco, oxigenación, presión arterial o solicitar recomendaciones personalizadas en tiempo real.`;
};
