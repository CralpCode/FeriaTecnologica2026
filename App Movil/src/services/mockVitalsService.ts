import { VitalSigns, VitalsHistoryPoint, TimeRange, DeviceInfo } from '../types/vitals';

// Estado mutable para simular variación continua y coherente
let currentVitalsState: VitalSigns = {
  heartRate: 74,
  bloodOxygen: 98,
  systolicPressure: 118,
  diastolicPressure: 78,
  temperature: 36.6,
  hrv: 55,
  stressLevel: 22,
  audio_rms: 18.5,
  audio_peak: 28.0,
  steps: 5430,
  calories: 365,
  timestamp: new Date().toISOString(),
};

// Variable para forzar anomalías en presentaciones / feria tecnológica
let simulationOverride: 'normal' | 'tachycardia' | 'hypertension' | 'hypoxia' | 'stress' = 'normal';

export const setSimulationScenario = (scenario: typeof simulationOverride) => {
  simulationOverride = scenario;
  updateCurrentVitals();
};

export const getSimulationScenario = () => simulationOverride;

export const updateCurrentVitals = (): VitalSigns => {
  const now = new Date();

  // Variación natural básica (+/- 1-2 unidades)
  const randomShift = (range: number) => (Math.random() - 0.5) * range;

  if (simulationOverride === 'tachycardia') {
    currentVitalsState = {
      heartRate: Math.round(118 + Math.random() * 12), // Taquicardia > 115 bpm
      bloodOxygen: 97,
      systolicPressure: 130,
      diastolicPressure: 84,
      temperature: 36.9,
      hrv: 28,
      stressLevel: 78,
      audio_rms: 34.0,
      audio_peak: 48.0,
      steps: currentVitalsState.steps + Math.floor(Math.random() * 3),
      calories: currentVitalsState.calories + 1,
      timestamp: now.toISOString(),
    };
  } else if (simulationOverride === 'hypertension') {
    currentVitalsState = {
      heartRate: Math.round(88 + Math.random() * 6),
      bloodOxygen: 96,
      systolicPressure: Math.round(146 + Math.random() * 8), // Hipertensión etapa 2
      diastolicPressure: Math.round(94 + Math.random() * 4),
      temperature: 36.7,
      hrv: 35,
      stressLevel: 68,
      audio_rms: 22.0,
      audio_peak: 32.0,
      steps: currentVitalsState.steps + Math.floor(Math.random() * 2),
      calories: currentVitalsState.calories + 1,
      timestamp: now.toISOString(),
    };
  } else if (simulationOverride === 'hypoxia') {
    currentVitalsState = {
      heartRate: Math.round(96 + Math.random() * 6),
      bloodOxygen: Math.round(91 + Math.random() * 2), // Hipoxia < 94%
      systolicPressure: 122,
      diastolicPressure: 80,
      temperature: 36.6,
      hrv: 32,
      stressLevel: 62,
      audio_rms: 16.0,
      audio_peak: 24.0,
      steps: currentVitalsState.steps,
      calories: currentVitalsState.calories,
      timestamp: now.toISOString(),
    };
  } else if (simulationOverride === 'stress') {
    currentVitalsState = {
      heartRate: Math.round(94 + Math.random() * 8),
      bloodOxygen: 97,
      systolicPressure: 134,
      diastolicPressure: 86,
      temperature: 36.8,
      hrv: 24, // HRV bajo indica alto estrés fisiológico
      stressLevel: Math.round(84 + Math.random() * 10),
      audio_rms: 42.0,
      audio_peak: 58.0,
      steps: currentVitalsState.steps + 2,
      calories: currentVitalsState.calories + 1,
      timestamp: now.toISOString(),
    };
  } else {
    // Escenario Fisiológico Normal con pequeñas oscilaciones naturales
    const newHR = Math.max(62, Math.min(88, Math.round(currentVitalsState.heartRate + randomShift(4))));
    const newO2 = Math.max(96, Math.min(100, Math.round(currentVitalsState.bloodOxygen + randomShift(1.2))));
    const newSys = Math.max(112, Math.min(124, Math.round(currentVitalsState.systolicPressure + randomShift(2))));
    const newDia = Math.max(74, Math.min(82, Math.round(currentVitalsState.diastolicPressure + randomShift(2))));
    const newTemp = Math.round((currentVitalsState.temperature + randomShift(0.1)) * 10) / 10;
    const newHrv = Math.max(45, Math.min(70, Math.round(currentVitalsState.hrv + randomShift(3))));
    const newStress = Math.max(10, Math.min(38, Math.round(currentVitalsState.stressLevel + randomShift(4))));

    currentVitalsState = {
      heartRate: newHR,
      bloodOxygen: newO2,
      systolicPressure: newSys,
      diastolicPressure: newDia,
      temperature: newTemp,
      hrv: newHrv,
      stressLevel: newStress,
      audio_rms: 18.5,
      audio_peak: 26.0,
      steps: currentVitalsState.steps + Math.floor(Math.random() * 4),
      calories: currentVitalsState.calories + (Math.random() > 0.6 ? 1 : 0),
      timestamp: now.toISOString(),
    };
  }

  return currentVitalsState;
};

export const getMockCurrentVitals = (): VitalSigns => {
  return updateCurrentVitals();
};

export const getMockHistory = (range: TimeRange): VitalsHistoryPoint[] => {
  const points: VitalsHistoryPoint[] = [];

  if (range === '24h') {
    // 12 puntos cada 2 horas
    const hours = ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];
    hours.forEach((h, index) => {
      // Modulación diurna (más bajo de madrugada, pico al mediodía)
      const isNight = index < 4;
      points.push({
        timeLabel: h,
        heartRate: isNight ? Math.round(58 + Math.random() * 8) : Math.round(72 + Math.random() * 18),
        bloodOxygen: Math.round(97 + Math.random() * 2),
        systolicPressure: isNight ? Math.round(108 + Math.random() * 8) : Math.round(118 + Math.random() * 10),
        diastolicPressure: isNight ? Math.round(68 + Math.random() * 6) : Math.round(76 + Math.random() * 8),
        temperature: 36.4 + Math.round(Math.random() * 4) / 10,
        stressLevel: isNight ? Math.round(8 + Math.random() * 10) : Math.round(25 + Math.random() * 30),
      });
    });
  } else if (range === '7d') {
    const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    days.forEach((day) => {
      points.push({
        timeLabel: day,
        heartRate: Math.round(70 + Math.random() * 12),
        bloodOxygen: Math.round(97 + Math.random() * 2),
        systolicPressure: Math.round(116 + Math.random() * 10),
        diastolicPressure: Math.round(76 + Math.random() * 6),
        temperature: 36.5 + Math.round(Math.random() * 3) / 10,
        stressLevel: Math.round(20 + Math.random() * 25),
      });
    });
  } else {
    // 30 días agrupados por semanas
    const weeks = ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'];
    weeks.forEach((week) => {
      points.push({
        timeLabel: week,
        heartRate: Math.round(71 + Math.random() * 8),
        bloodOxygen: 98,
        systolicPressure: Math.round(118 + Math.random() * 6),
        diastolicPressure: Math.round(77 + Math.random() * 4),
        temperature: 36.6,
        stressLevel: Math.round(22 + Math.random() * 18),
      });
    });
  }

  return points;
};

export const getMockDeviceInfo = (): DeviceInfo => ({
  name: 'SpiroScan Band X9',
  model: 'SS-PRO-2026',
  connected: true,
  battery: 84,
  lastSync: 'Hace unos instantes',
  firmwareVersion: 'v2.4.1-BLE',
  signalStrength: 'excellent',
});
