# SpiroScan: conocimiento verificado del prototipo

Actualizado el 3 de octubre de 2026. Evidencia técnica: `IA/docs/audit_results.json` y `docs/INFORME_MEJORAS_2026-10-03.md`.

## Alcance real

Prototipo de tamizaje cardiorrespiratorio con ESP32, MAX30102 e INMP441. El PDF de construcción propone auscultar cuatro focos cardíacos y detectar sonidos compatibles con soplo para orientar referencia. No identifica por sí solo una enfermedad valvular ni cardiopatía reumática.

## Datos disponibles

- El firmware obtiene señales roja e infrarroja del MAX30102 y estima pulso, con controles de contacto, calidad, estabilización y caducidad.
- La SpO2 queda **no disponible**: el cálculo anterior incluía valores inventados y recortes. Se requiere implementar y validar un algoritmo calibrado para el sistema óptico completo. No se debe activar un indicador de calibración para saltar este requisito.
- HRV, estrés, presión arterial, temperatura corporal y ECG no se presentan como mediciones válidas.
- El INMP441 graba sonido. El nivel digital en dBFS no es presión sonora en dB SPL.
- La edad, síntomas, reposo, altitud y antecedentes provienen de respuestas explícitas del usuario. Un dato no contestado permanece desconocido.
- Las demostraciones no representan signos vitales del paciente ni se incorporan a la valoración clínica.

## IA acústica

Existe una CNN cardíaca con pesos previos entrenados con CirCor y PhysioNet 2016. Clasifica anormalidad acústica; las etiquetas de ambos conjuntos no son equivalentes a diagnóstico de enfermedad.

La reevaluación retrospectiva de 1,226 audios reproduce sensibilidad 89.70 %, especificidad 91.64 % y AUC 0.97076: 209 verdaderos positivos, 24 falsos negativos, 910 verdaderos negativos y 83 falsos positivos. La partición se reconstruyó desde el código/semilla; no hay manifiesto original que certifique todo el historial. No es validación externa, ni prueba con pacientes usando este hardware. El rendimiento varía considerablemente entre fuentes.

El descriptor de características del soplo permanece desactivado: la auditoría reconstruida halló 31 de 36 pacientes de prueba compartidos con entrenamiento/validación del extractor base. No deben citarse sus métricas antiguas como validación independiente.

### Pulmones
Con la base pública ICBHI 2017 (126 pacientes, 920 grabaciones) se entrenaron dos modelos de pulmón y se
evaluaron con pacientes no vistos. Solo se muestra lo confiable:
- Sibilancias: SÍ se muestran. En grabaciones completas detecta ≈ 59 % de las que tienen sibilancias y
  reconoce ≈ 81 % de las normales (AUC ≈ 0.72).
- Crepitantes: NO se muestran (AUC ≈ 0.53, casi como adivinar).
- Patrón por enfermedad (EPOC, neumonía, etc.): NO se muestra; hay muy pocos pacientes por enfermedad
  (acierto balanceado ≈ 47 %). Reconoce bien EPOC y sanos, pero falla en las demás.
Es una sugerencia para referir, nunca un diagnóstico.

Hay un modelo pulmonar base de regresión logística. Su puntaje ICBHI reportado por el autor no se volvió a verificar con el dataset completo. No hay pesos CNN pulmonares entrenados disponibles. Faltan los audios ICBHI y su partición oficial en la copia de trabajo; tener fichas clínicas no equivale a tener esos audios.

## Valoración orientativa

Se combinan resultados acústicos, mediciones válidas y síntomas mediante reglas explícitas con fuentes FDA, NHLBI y NICE. Pueden sugerirse causas para investigar, con explicación y pruebas confirmatorias. No existe aquí una red multimodal validada ni porcentajes de enfermedad o de salud. Los síntomas de alarma tienen prioridad incluso si los sensores parecen normales.

La API, el semáforo, los informes y el resumen clínico del asistente comparten este motor. Los textos clínicos son deterministas para evitar que un modelo generativo agregue datos. El LLM local conserva su función de guía de uso, separado de las decisiones clínicas.

## Uso

1. Crear una sesión distinta para cada persona.
2. Abrir **Auscultar**, completar lo conocido y conservar **No sé** en lo desconocido.
3. Registrar audio real en los focos correspondientes y adquirir pulso estable.
4. Pulsar **Guardar y evaluar esta sesión**. Leer hallazgos, posibilidades, datos faltantes y pasos sugeridos.
5. Si hay síntomas graves, no esperar a la IA. La confirmación corresponde a personal de salud.

La calibración acústica con fantoma descrita en el PDF sigue pendiente de medición física. No se afirma haberla realizado. Tampoco se ha flasheado el ESP32 durante esta tarea.
