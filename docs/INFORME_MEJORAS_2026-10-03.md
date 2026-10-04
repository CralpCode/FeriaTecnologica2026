# Revisión e integración de SpiroScan — 3 de octubre de 2026

Se revisó el PDF `manual-construccion-estetoscopio-v2_260926_192209.pdf`, sus diez páginas, el firmware ESP32, los puentes, la API, la aplicación y los modelos/datos locales. El objetivo alcanzable es una **valoración orientativa verificable**; no se ha validado un sistema de diagnóstico de enfermedades en pacientes.

## Cambios realizados

1. **Adquisición MAX30102.** Eliminada la generación sinusoidal de SpO2 alrededor de 98.2 % al fallar el cálculo y el recorte artificial a 91–99.8 %. También se retiraron valores forzados de HRV y estrés. Se leen muestras FIFO roja/infrarroja sin duplicarlas, con detección de contacto, saturación, pérdida de muestras, estabilización y caducidad. La SpO2 está no disponible hasta tener algoritmo y calibración comprobados. No se debe sustituir por un número aparentemente normal.
2. **Procedencia y validez.** Firmware, gateways y simuladores transmiten origen real/simulado/desconocido y campos de validez. Audio físico indica origen real. La base conserva estos metadatos; los registros antiguos sin procedencia no se convierten automáticamente en clínicos. El audio digital se identifica como dBFS, no dB SPL.
3. **Aislamiento de personas.** Corregida la consulta que, si no encontraba datos de una sesión, podía devolver los de otra. Exportaciones e historial quedan restringidos a la sesión solicitada. Se respetan los periodos de historial.
4. **Datos clínicos declarados.** Nuevo formulario por sesión para edad, reposo, altitud, síntomas y antecedentes. Respuestas Sí/No/No sé; no se inventa ausencia de síntomas. Backend valida rangos y tipos.
5. **Motor de orientación.** Nuevo `Backend/clinical_assessment.py`: combina únicamente mediciones aceptables y grabaciones recientes de la sesión. Devuelve hallazgos, causas posibles sin porcentajes, evidencia, pruebas confirmatorias, datos faltantes, limitaciones y fuentes. Incluye orientación sobre soplos, sibilancias/asma, EPOC, infección respiratoria/neumonía y congestión, cuando hay contexto que lo sustente. No es una lista exhaustiva ni un clasificador entrenado de esas enfermedades.
6. **Alarma y falta de datos.** Síntomas de alarma tienen prioridad sobre sensores normales. No se aplican límites de pulso adulto a niños. Se exige edad/reposo para interpretar el pulso. Las ventanas temporales y los umbrales de aviso son decisiones del prototipo, no un protocolo clínico validado. Una mala lectura posterior invalida mediciones previas; una repetición fallida de audio reemplaza el resultado anterior de ese foco.
7. **Modelos e inferencia.** Rechazo de silencio, señal plana, saturación y datos no finitos. No se rellenan características faltantes con ceros. Si no hay salidas utilizables, se devuelve indeterminado y no normal. Las salidas numéricas se identifican como puntuaciones de modelo sin calibración clínica.
8. **Auditoría cardíaca reproducible.** `IA/audit_models.py` y `IA/docs/audit_results.json` documentan particiones reconstruidas, hashes y predicciones. Se mantuvieron los pesos existentes; no se afirma un nuevo entrenamiento ni mejora de exactitud demostrada.
9. **Corrección de evaluación de soplos.** Desactivada la descripción de intensidad/forma del soplo por contaminación entre evaluación y extractor base. Los entrenadores se corrigieron para separar pacientes y usar validación, no prueba, para selección. Se exige partición oficial de ICBHI en lugar de presentar fichas locales como partición oficial.
10. **Aplicación.** Panel clínico integrado en Auscultar, datos inválidos como `--`, gráfico filtrado por procedencia/calidad y sin oxígeno clínico no calibrado. La animación de pulso se identifica como ilustrativa, no ECG. Quitadas puntuaciones de salud y certeza inventadas.
11. **Informes y asistente.** Semáforo, API, informe y resumen del asistente usan el mismo motor. Los textos clínicos son deterministas; el LLM conserva guía de uso, pero no decide enfermedades ni agrega signos vitales. Exportaciones vacías representan datos faltantes; se eliminaron títulos como “reporte clínico oficial” o “verificado por Bio-IA”.
12. **Verificación.** Pruebas automáticas de sensores/gateway, inferencia y API; TypeScript y compilación web. Se usa una base temporal para las pruebas, no datos de pacientes. Las señales artificiales de pruebas unitarias están explícitamente rotuladas y nunca se usan para entrenar o medir exactitud clínica.

## Qué indican las métricas reales

Reevaluación del modelo cardíaco existente en **1,226 audios** con partición reconstruida desde código y semilla:

| Medida | Resultado |
|---|---:|
| Sensibilidad | 89.6996 % |
| Especificidad | 91.6415 % |
| AUC | 0.970761 |
| Verdaderos positivos / falsos negativos | 209 / 24 |
| Verdaderos negativos / falsos positivos | 910 / 83 |

Estos números **no significan 90 % de certeza para una persona**. No constituyen validación externa ni precisión clínica del dispositivo. El archivo JSON guarda resultados por fuente: por ejemplo, la especificidad en PhysioNet-a es aproximadamente 53.6 %, muy inferior a la global. Tampoco se certifica independencia por paciente en fuentes donde el identificador sólo corresponde a grabación.

Se encontraron 6,704 WAV por copia de datos local. Los 301 archivos de la carpeta de validación son duplicados exactos por SHA256 de audios de entrenamiento: no son una prueba externa. En la reconstrucción del descriptor de soplos, 31 de 36 pacientes de prueba aparecían en entrenamiento/validación del extractor base.

## Lo pendiente para mejorar precisión de verdad

- **MAX30102:** implementar y validar el cálculo de SpO2 para el montaje concreto. Comparar únicamente en condiciones apropiadas contra referencia; no inducir desaturación ni calibrar con porcentajes inventados. Un indicador `spo2Calibrated=true` no constituye calibración.
- **Acústica:** medir la respuesta del instrumento/fantoma como indica el PDF. No se fabricaron curvas de transferencia ni se aplicó una corrección acústica no medida.
- **Pulmón:** faltan audios y división oficial ICBHI. La consulta HTTPS directa al archivo oficial falló por verificación del certificado en este entorno. No se desactivó TLS ni se afirmó un entrenamiento inexistente. El entrenamiento preparado debe ejecutarse cuando se disponga del conjunto completo, conservando pacientes separados y dejando la prueba sin usar para elegir modelos.
- **Enfermedades:** se necesita evidencia etiquetada de la misma persona, con sensores, síntomas y diagnóstico clínico de referencia, para entrenar y validar una combinación multimodal. No se combinaron artificialmente pacientes de distintos datasets para simular esa evidencia.
- **Hardware y clínica:** no se flasheó ni se verificó físicamente el circuito. No se realizó validación prospectiva en pacientes. Las mejoras de software reducen errores conocidos; no prueban un aumento de exactitud clínica.

## Cómo usar y reproducir

La carpeta de implementación es `FeriaTecnologica2026`; no se sincronizó la copia histórica `spiroscan-analysis`.

Arrancar el backend habitual desde `Backend` con el Python del entorno del proyecto. Iniciar Expo desde `App Movil` o volver a generar `App Movil/dist` con `npx expo export --platform web`. El firmware fuente debe compilarse y cargarse en el dispositivo para que lleguen los nuevos indicadores; paquetes de firmware antiguo se tratan como procedencia desconocida.

En la app: **Auscultar → Valoración orientativa → Guardar y evaluar esta sesión**. Crear una sesión por persona; no reutilizar síntomas de la anterior.

Desde la raíz de `spirosan`:

```sh
.venv/bin/python -m unittest discover -s FeriaTecnologica2026/Backend/tests -v
.venv/bin/python -m unittest discover -s FeriaTecnologica2026/IA/tests -v
.venv/bin/python -m unittest discover -s FeriaTecnologica2026/Esp32/tests -v
```

Desde `FeriaTecnologica2026/App Movil`:

```sh
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/expo export --platform web
```

Para repetir la auditoría, ejecutar `../../.venv/bin/python audit_models.py` desde `IA` con los datasets locales presentes. No se deben mezclar sus métricas con las pruebas unitarias artificiales.

## Fuentes consultadas

- [FDA — Pulse Oximeters](https://www.fda.gov/medical-devices/products-and-medical-procedures/pulse-oximeters): limitaciones de oximetría, factores que afectan las lecturas y necesidad de considerar síntomas.
- [Analog Devices — Guidelines for SpO2 Measurement](https://www.analog.com/en/resources/technical-articles/guidelines-for-spo2-measurement--maxim-integrated.html): calibración del sistema de medición.
- [NHLBI — Heart Valve Diseases: Diagnosis](https://www.nhlbi.nih.gov/health/heart-valve-diseases/diagnosis): evaluación clínica y ecocardiografía para investigar sonidos y enfermedad valvular.
- [NICE NG245 — Asthma](https://www.nice.org.uk/guidance/ng245/chapter/recommendations): diagnóstico apoyado por historia y pruebas objetivas.
- [NICE NG115 — COPD](https://www.nice.org.uk/guidance/ng115/chapter/recommendations): confirmación con espirometría posterior a broncodilatador.
- [NHLBI — Pneumonia: Diagnosis](https://www.nhlbi.nih.gov/health/pneumonia/diagnosis): valoración y estudios complementarios.
- [NHLBI — Heart Failure: Diagnosis](https://www.nhlbi.nih.gov/health/heart-failure/diagnosis): pruebas de confirmación.
- [NHS — Shortness of breath](https://www.nhs.uk/conditions/shortness-of-breath/): señales para atención urgente.
- [ICBHI 2017 — Respiratory Sound Database](https://bhichallenge.med.auth.gr/ICBHI_2017_Challenge): audios, anotaciones y partición oficial.
- [PhysioNet — CirCor DigiScope](https://physionet.org/content/circor-heart-sound/1.0.3/) y [PhysioNet/CinC 2016](https://physionet.org/content/challenge-2016/1.0.0/): fuentes de los modelos cardíacos existentes.

## Resultado de las comprobaciones finales

- 18 pruebas del backend/flujo clínico, 9 de inferencia y datos, 5 del gateway: **32 aprobadas**.
- Prueba nativa C++ del estado PPG: aprobada. Compilación de la unidad de firmware con toolchain Xtensa comprobada durante la revisión; no equivale a carga ni prueba física completa.
- TypeScript sin errores y exportación web de Expo completada.
- Navegador: guardado del formulario y evaluación sin datos comprobados; devuelve datos insuficientes y conserva desconocidos.
- Informe PDF de prueba sin datos de pacientes generado para comprobar la salida.
- No se registraron datos inventados como evidencia clínica ni se usaron las señales de pruebas unitarias para las métricas publicadas.
