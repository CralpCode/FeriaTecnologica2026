import React from 'react';
import { AuscultationScreen } from './AuscultationScreen';

/** Mantiene el acceso pulmonar de main con el análisis de grabaciones del servidor. */
export const PulmonaryAIScreen: React.FC = () => <AuscultationScreen initialMode="pulmon" />;
