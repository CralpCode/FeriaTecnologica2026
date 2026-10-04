/**
 * SCRIPT AUTOMATIZADO PARA CREAR EL GOOGLE FORM DEL PROYECTO
 * Proyecto: Sistema Embebido para Captura y Análisis de Señales Cardiorrespiratorias
 * 
 * VERSIÓN: Navegación Libre y Flexible (Sin bloqueos de "Siguiente" / "Atrás")
 * 
 * ¿QUÉ CAMBIÓ?
 * En Google Forms, si una pregunta es "Obligatoria", el sistema BLOQUEA de forma
 * estricta los botones "Siguiente" e impide avanzar si no se responde.
 * En esta versión, los campos permiten navegación libre para que el equipo o el
 * paciente puedan saltarse secciones, ir adelante, volver atrás o completar
 * las mediciones en el orden que prefieran.
 */

function crearFormularioClinico() {
  // CONFIGURACIÓN DE BLOQUEO:
  // false = Permite avanzar y retroceder libremente por todas las secciones sin trabarse.
  // true  = Exige responder cada pregunta antes de poder dar clic en "Siguiente".
  var EXIGIR_RESPUESTAS = false; 

  // Crear el formulario con título y descripción
  var form = FormApp.create('Evaluación Cardiorrespiratoria - Línea Base (Navegación Libre)');
  form.setDescription(
    'Protocolo de tamizaje, antecedentes clínicos y registro de signos vitales tradicionales.\n\n' +
    '📌 NOTA DE NAVEGACIÓN: Puedes usar los botones "Siguiente" y "Atrás" libremente para moverte entre ' +
    'secciones o realizar las mediciones físicas antes de llenar la encuesta si así lo prefieren.\n\n' +
    '• Secciones 1 a 4: Encuesta al participante (Demografía, Antecedentes, Síntomas, Hábitos).\n' +
    '• Sección 5: Mediciones del evaluador (BP3MW1, Termómetro, Estetoscopio).'
  );
  
  // ==========================================
  // SECCIÓN 1: Identificación y Antropometría
  // ==========================================
  var sec1 = form.addPageBreakItem().setTitle('Sección 1: Identificación y Antropometría');
  
  form.addTextItem()
    .setTitle('ID de Sujeto')
    .setHelpText('Código anónimo asignado al participante (ej. P_001, P_002...)')
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addTextItem()
    .setTitle('Edad (años cumplidos)')
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addMultipleChoiceItem()
    .setTitle('Sexo biológico')
    .setChoiceValues(['Femenino', 'Masculino'])
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addTextItem()
    .setTitle('Estatura aproximada (en centímetros, ej. 170)')
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addTextItem()
    .setTitle('Peso aproximado (en kilogramos, ej. 68.5)')
    .setRequired(EXIGIR_RESPUESTAS);

  // ==========================================
  // SECCIÓN 2: Antecedentes Clínicos
  // ==========================================
  var sec2 = form.addPageBreakItem().setTitle('Sección 2: Antecedentes Clínicos y Factores de Riesgo');
  
  form.addCheckboxItem()
    .setTitle('Antecedentes respiratorios diagnosticados')
    .setChoiceValues([
      'Ninguno (Sano)',
      'Asma',
      'EPOC (Enfermedad Pulmonar Obstructiva Crónica) / Enfisema',
      'Bronquitis crónica o recurrente',
      'Rinitis alérgica',
      'Neumonía reciente (en los últimos 6 meses)'
    ])
    .showOtherOption(true)
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addCheckboxItem()
    .setTitle('Antecedentes cardiovasculares diagnosticados')
    .setChoiceValues([
      'Ninguno',
      'Hipertensión arterial',
      'Arritmias diagnosticadas',
      'Soplo cardíaco conocido'
    ])
    .showOtherOption(true)
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addMultipleChoiceItem()
    .setTitle('Tabaquismo / Exposición a humos')
    .setChoiceValues([
      'No fumador',
      'Fumador activo',
      'Exfumador',
      'Vapeador (cigarrillo electrónico)',
      'Exposición regular y frecuente a humo de leña o químicos'
    ])
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addParagraphTextItem()
    .setTitle('Medicación actual relevante')
    .setHelpText('Inhaladores (ej. salbutamol), antihipertensivos, antihistamínicos, etc. (O dejar vacío si no aplica)')
    .setRequired(EXIGIR_RESPUESTAS);

  // ==========================================
  // SECCIÓN 3: Síntomas en las Últimas 48 Horas
  // ==========================================
  var sec3 = form.addPageBreakItem().setTitle('Sección 3: Síntomas en las Últimas 48 Horas');
  
  form.addMultipleChoiceItem()
    .setTitle('¿Presenta tos en este momento o en los últimos 2 días?')
    .setChoiceValues([
      'No',
      'Sí, tos seca (sin flemas)',
      'Sí, tos productiva (con expectoración / flemas)'
    ])
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addScaleItem()
    .setTitle('Dificultad para respirar (Escala de disnea funcional)')
    .setBounds(0, 3)
    .setLabels('0: Sin dificultad (Normal)', '3: Dificultad al vestirse o en reposo')
    .setHelpText('0 = Normal; 1 = Solo al subir cuestas/escaleras; 2 = Al caminar en plano; 3 = En reposo')
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addMultipleChoiceItem()
    .setTitle('¿Sensación de silbido en el pecho ("pecho cerrado")?')
    .setChoiceValues(['No', 'Sí'])
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addMultipleChoiceItem()
    .setTitle('¿Presenta síntomas de resfriado común o congestión nasal activa?')
    .setChoiceValues(['No', 'Sí'])
    .setRequired(EXIGIR_RESPUESTAS);

  // ==========================================
  // SECCIÓN 4: Control Inmediato Previo a la Prueba
  // ==========================================
  var sec4 = form.addPageBreakItem().setTitle('Sección 4: Control de Artefactos Inmediato');
  
  form.addMultipleChoiceItem()
    .setTitle('¿Consumió café, té, bebidas energéticas o refresco de cola en la última hora?')
    .setChoiceValues(['No', 'Sí'])
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addMultipleChoiceItem()
    .setTitle('¿Fumó o vapeó en los últimos 30 minutos?')
    .setChoiceValues(['No', 'Sí'])
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addMultipleChoiceItem()
    .setTitle('¿Realizó actividad física vigorosa o caminó a paso apresurado antes de ingresar?')
    .setChoiceValues(['No', 'Sí'])
    .setRequired(EXIGIR_RESPUESTAS);

  // ==========================================
  // SECCIÓN 5: Registro Instrumental (Llenado por el Evaluador)
  // ==========================================
  var sec5 = form.addPageBreakItem().setTitle('Sección 5: Mediciones del Evaluador (Signos Vitales y Auscultación)');
  
  form.addTextItem()
    .setTitle('Presión Arterial Sistólica - PAS (mmHg) [CVS Health BP3MW1]')
    .setHelpText('Valor superior en el monitor (ej. 120)')
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addTextItem()
    .setTitle('Presión Arterial Diastólica - PAD (mmHg) [CVS Health BP3MW1]')
    .setHelpText('Valor inferior en el monitor (ej. 80)')
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addTextItem()
    .setTitle('Frecuencia Cardíaca / Pulso (BPM) [CVS Health BP3MW1]')
    .setHelpText('Pulsaciones por minuto registradas por el monitor digital (ej. 72)')
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addTextItem()
    .setTitle('Temperatura Corporal (°C) [Termómetro]')
    .setHelpText('Temperatura axilar, ótica o frontal (ej. 36.6)')
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addTextItem()
    .setTitle('Frecuencia Respiratoria (rpm) [Estetoscopio / Reloj]')
    .setHelpText('Ciclos respiratorios contados en 60 segundos (ej. 16)')
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addMultipleChoiceItem()
    .setTitle('Auscultación Pulmonar: Murmullo vesicular')
    .setChoiceValues([
      'Normal y audible en ambos hemitórax',
      'Disminuido / Hipoacústico'
    ])
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addCheckboxItem()
    .setTitle('Auscultación Pulmonar: Ruidos adventicios agregados')
    .setChoiceValues([
      'Ninguno (Campos limpios)',
      'Sibilancias (Wheezes - ruidos agudos musicales)',
      'Crepitantes (Crackles - ruidos tipo velcro/burbujeo)',
      'Roncus (ruidos graves de secreción)'
    ])
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addMultipleChoiceItem()
    .setTitle('Auscultación Cardíaca: Ritmo R1 y R2')
    .setChoiceValues([
      'Rítmico y regular',
      'Arrítmico / Irregular'
    ])
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addMultipleChoiceItem()
    .setTitle('Auscultación Cardíaca: Presencia de soplos')
    .setChoiceValues([
      'No audible (Sonidos limpios)',
      'Soplo audible o sospechoso'
    ])
    .setRequired(EXIGIR_RESPUESTAS);
    
  form.addParagraphTextItem()
    .setTitle('Observaciones adicionales del evaluador')
    .setHelpText('Anotaciones sobre conducta, dificultad para medir, tos durante la prueba, etc.')
    .setRequired(false);

  // Obtener URLs y mostrarlas en la consola
  Logger.log('====================================================');
  Logger.log(' ¡FORMULARIO CON NAVEGACIÓN LIBRE CREADO CON ÉXITO!');
  Logger.log(' Enlace para EDITAR (Tuyo): ' + form.getEditUrl());
  Logger.log(' Enlace para RESPONDER (Público): ' + form.getPublishedUrl());
  Logger.log('====================================================');
}
