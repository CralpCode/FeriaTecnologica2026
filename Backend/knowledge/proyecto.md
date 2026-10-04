# SpiroScan · Base de conocimiento del proyecto

Este archivo es la ÚNICA fuente que usa el asistente para explicar el proyecto a visitantes y jurado.
Para "enseñarle" algo nuevo al asistente, el equipo edita este archivo (no hace falta reentrenar nada).

## Qué es
SpiroScan es un prototipo universitario de tamizaje cardiorrespiratorio de bajo costo (presupuesto ≤ Q500).
Combina un estetoscopio digital con inteligencia artificial y un sensor óptico de pulso.
Su objetivo es identificar a quién conviene referir a un ecocardiograma. NO diagnostica.

## Componentes
- ESP32: microcontrolador que lee los sensores y envía los datos por WiFi al servidor.
- INMP441: micrófono digital MEMS (I2S) acoplado a la pieza del estetoscopio. Graba 15 s a 16 kHz.
- MAX30102: sensor óptico que mide pulso (BPM) y saturación de oxígeno (SpO2) en el dedo.
- 8 LEDs WS2812: muestran el estado (azul grabando, verde normal, rojo posible soplo, naranja mala calidad).
- Servidor: una Mac del equipo con la base de datos, la red neuronal y el asistente de lenguaje, todo local y sin internet.

## Qué mide y qué no
- Mide: pulso, SpO2, variabilidad entre latidos (HRV) y el sonido del corazón y de los pulmones.
- No mide: presión arterial, temperatura corporal ni electrocardiograma.

## La red neuronal (CNN)
- Convierte el audio en un espectrograma log-mel (una "imagen" del sonido) y una red convolucional estima la
  probabilidad de un sonido cardíaco anormal (por ejemplo un soplo).
- Entrenada con dos bases públicas: CirCor DigiScope 2022 y PhysioNet/CinC 2016.
- Evaluada con grabaciones de pacientes que la red nunca vio en entrenamiento: sensibilidad ≈ 90 %,
  especificidad ≈ 92 %, AUC ≈ 0.97. El umbral se eligió para no dejar pasar casos (tamizaje).
- Limitación: validada con estetoscopios clínicos de las bases de datos, aún no con pacientes reales.

## Características del soplo
Cuando la red detecta un posible soplo, un segundo modelo (entrenado con las anotaciones de CirCor) describe
cómo suena. Solo se muestran las características que el modelo acierta claramente mejor que el azar en
pacientes no vistos: la intensidad (leve o moderada/mayor, ≈ 76 % de acierto balanceado) y la forma
(meseta, decreciente o romboidal, ≈ 61 %). Describe el sonido; NO dice la causa del soplo.

## Pulmones
Con la base pública ICBHI 2017 (126 pacientes, 920 grabaciones) se entrenaron dos modelos de pulmón y se
evaluaron con pacientes no vistos. Solo se muestra lo confiable:
- Sibilancias: SÍ se muestran. En grabaciones completas detecta ≈ 59 % de las que tienen sibilancias y
  reconoce ≈ 81 % de las normales (AUC ≈ 0.72).
- Crepitantes: NO se muestran (AUC ≈ 0.53, casi como adivinar).
- Patrón por enfermedad (EPOC, neumonía, etc.): NO se muestra; hay muy pocos pacientes por enfermedad
  (acierto balanceado ≈ 47 %). Reconoce bien EPOC y sanos, pero falla en las demás.
Es una sugerencia para referir, nunca un diagnóstico.

## Triaje combinado (semáforo)
Une la SpO2, el pulso, el resultado del corazón y el del pulmón con reglas fijas definidas por el equipo:
rojo (prioridad alta, p. ej. SpO2 < 90 % o hallazgo pulmonar con SpO2 < 94 %), amarillo (referir a
evaluación, p. ej. posible soplo o SpO2 entre 90 y 93 %), verde (sin hallazgos) y gris (faltan datos).
No es una IA entrenada: ninguna base pública trae audio y SpO2 del mismo paciente.

## Aporte original: corrección acústica
Un estetoscopio barato "suena distinto" a uno clínico de $300. Con un fantoma (una caja con tejido simulado y un
parlante) se reproduce el audio clínico, se graba con nuestro dispositivo y se calcula la función de transferencia
(barrido sinusoidal de 20 Hz a 2 kHz, método de Farina). Con esa medición se adaptan los datos de entrenamiento
para que la red funcione con nuestro instrumento. El fantoma no imita la propagación en tejido vivo; sirve para
medir de forma controlada y repetible la respuesta del instrumento.

## Cómo se usa
1. En la app se elige el foco (aórtico, pulmonar, tricuspídeo o mitral) y se toca "Preparar grabación".
2. Se apoya el estetoscopio en el pecho y se mantiene presionado el botón 1 segundo.
3. En unos segundos aparece el resultado en la app y en los LEDs.
4. Al final se puede generar un informe PDF con nota de referencia para personal de salud.

## El asistente de lenguaje
Un modelo de lenguaje local (Qwen, corriendo en la Mac) redacta los textos: alertas, informes, respuestas y guía.
No decide nada: las alertas vienen de reglas fijas y el resultado del audio viene de la red neuronal.

## Lo que el proyecto NO afirma
- No diagnostica: detecta posibles hallazgos y sugiere referencia médica.
- No detecta cardiopatía reumática directamente (las bases etiquetan soplos, no diagnósticos por ecocardiograma).
- No se probó en pacientes: toda la validación es con bases públicas y el fantoma.
- No sustituye al ecocardiograma ni a la evaluación clínica.
