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
- Mide: pulso, SpO2, variabilidad entre latidos (HRV) y el sonido del corazón.
- No mide: presión arterial, temperatura corporal ni electrocardiograma.

## La red neuronal (CNN)
- Convierte el audio en un espectrograma log-mel (una "imagen" del sonido) y una red convolucional estima la
  probabilidad de un sonido cardíaco anormal (por ejemplo un soplo).
- Entrenada con dos bases públicas: CirCor DigiScope 2022 y PhysioNet/CinC 2016.
- Evaluada con grabaciones de pacientes que la red nunca vio en entrenamiento: sensibilidad ≈ 90 %,
  especificidad ≈ 92 %, AUC ≈ 0.97. El umbral se eligió para no dejar pasar casos (tamizaje).
- Limitación: validada con estetoscopios clínicos de las bases de datos, aún no con pacientes reales.

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
