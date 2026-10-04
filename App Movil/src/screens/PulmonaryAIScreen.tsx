import React, { useState } from 'react';
import { ConsultaScreen } from './ConsultaScreen';

/** Acceso pulmonar de main mediante la consulta guiada. */
export const PulmonaryAIScreen: React.FC<{ onOpenAssistant: () => void }> = ({ onOpenAssistant }) => {
  const [step, setStep] = useState(4);
  return <ConsultaScreen step={step} onStepChange={setStep} onOpenAssistant={onOpenAssistant} />;
};
