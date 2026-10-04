# REGISTRO DE TAREAS PENDIENTES (BACKLOG DEL PROYECTO)
> **Proyecto:** Monitor Portátil de Salud Cardiorrespiratoria (Óptico + Acústico)  
> **Asignatura:** f tecno (8vo Semestre - 2026)  
> **Última actualización:** Septiembre 2026

Este documento contiene la lista detallada y priorizada de tareas.  
**Estrategia:** La **Fase 1** consolida la **base de captura y acondicionamiento de datos**. Las fases posteriores representan las **distintas alternativas de implementación** que se pueden desplegar sobre dicha base (triaje embebido, estetoscopio con IA, telemetría IoT o datalogger clínico).  
> 🧠 **Plan Detallado de Datos e IA (Bloque B):** Consulta la hoja de ruta técnica completa en [docs/PLAN_INICIAL_DATOS_IA.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/PLAN_INICIAL_DATOS_IA.md).

---

## Leyenda de Estados
* 🔴 **Prioridad Alta (Inmediato):** Bloqueante para las siguientes etapas de desarrollo.
* 🟡 **Prioridad Media:** Requerido para la integración funcional del prototipo.
* 🟢 **Prioridad Baja / Mejora Futura:** Optimización, diseño industrial o funciones avanzadas de software.

---

## Fase 1: Electrónica, Conexiones y Pruebas Unitarias de Hardware
*Objetivo: Verificar individualmente que cada componente opere correctamente sin riesgo de daño por voltaje o cortocircuito.*

- [ ] 🔴 **1.1 Esquema de conexión de energía y seguridad:**
  - Soldar o cablear la batería Li-Ion/LiPo a las terminales `B+` y `B-` del módulo TP4056.
  - Conectar el interruptor Rocker entre `OUT+` del TP4056 y el pin `VIN` del ESP32.
  - Conectar `OUT-` a `GND` común del ESP32.
  - Medir con multímetro los voltajes de salida antes de encender el ESP32.
- [ ] 🔴 **1.2 Prueba unitaria del Módulo Neopixel (WS2812 - 8 LEDs):**
  - Conectar DIN a GPIO 25 (homologado con el firmware de producción y Wokwi), VDD a VIN (o 5V) y GND a tierra común.
  - Cargar un sketch de prueba (usando librería `Adafruit_NeoPixel` o `FastLED`) para verificar colores RGB y brillo de cada uno de los 8 LEDs.
- [ ] 🔴 **1.3 Prueba unitaria del Sensor Óptico MAX30102:**
  - Conectar a 3.3V, GND, SDA (GPIO 21) y SCL (GPIO 22).
  - Ejecutar un I2C Scanner para confirmar la dirección del dispositivo (`0x57`).
  - Cargar código de lectura de datos brutos (LED Rojo e Infrarrojo) para verificar la respuesta al colocar el dedo sobre el sensor.
- [ ] 🔴 **1.4 Prueba unitaria del Micrófono Digital INMP441 (I2S):**
  - Conectar VDD a 3.3V, GND a tierra, L/R a GND (canal izquierdo), WS a GPIO 15, SCK a GPIO 14 y SD a GPIO 32 (homologado con el firmware y Wokwi).
  - Configurar el periférico I2S del ESP32 a 16 kHz / 16 bits.
  - Verificar la captura de audio enviando muestras por el Serial Plotter de Arduino IDE para observar la forma de onda de la voz o ruidos en tiempo real.
- [ ] 🔴 **1.5 Prueba unitaria del Botón de Control K1:**
  - Conectar una terminal a GPIO 17 y la otra a GND del ESP32 (modo `INPUT_PULLUP`).
  - Verificar que al presionar el pulsador se detecte el flanco de bajada para alternar modos o despertar el sistema.


---

## Fase 2: Gestión y Curación de Datos Clínicos
*Objetivo: Completar la disponibilidad local de las bases de datos para calibración y entrenamiento.*

- [x] 🔴 **2.1 Descargar los archivos de audio del desafío ICBHI 2017:**
  - Descargar el archivo comprimido oficial con las grabaciones `.wav` y anotaciones `.txt` desde el enlace de Kaggle registrado en [links.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/links.md). *(Completado: descargado y extraído en `data/ICBHI_final_database/`)*.
- [x] 🟡 **2.2 Ejecutar el script de organización automática:**
  - Implementar/ejecutar el script `organizar_por_categoria.py` mencionado en los archivos `LEEME.txt` para distribuir automáticamente los audios `.wav` de cada paciente en su subcarpeta correspondiente dentro de [ICBHI_organizado - pacientes de los links filtrados](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/data/ICBHI_organizado%20-%20pacientes%20de%20los%20links%20filtrados/). *(Completado: 920 pares .wav/.txt distribuidos en 126 pacientes y marcadores LEEME.txt removidos)*.
- [ ] 🟡 **2.3 Script de inspección acústica preliminar en Python:**
  - Crear un notebook o script en Python para graficar la forma de onda y el espectrograma (Mel-Spectrogram / FFT) de audios representativos de pacientes sanos vs. pacientes con EPOC, neumonía y sibilancias.

---

## Fase 3: Firmware y Procesamiento de Señales en ESP32
*Objetivo: Integrar los módulos en un flujo de procesamiento embebido continuo.*

- [ ] 🔴 **3.1 Algoritmo de cálculo de $SpO_2$ y Frecuencia Cardíaca:**
  - Implementar el filtrado de la señal PPG (filtro de media móvil para componente continua DC y filtro paso-banda para pulsos AC).
  - Aplicar el método de Ratio de Ratios ($R = \frac{AC_{red}/DC_{red}}{AC_{ir}/DC_{ir}}$) para calcular el porcentaje de saturación de oxígeno.
- [ ] 🔴 **3.2 Lógica de retroalimentación visual del Semáforo Neopixel:**
  - Modo Saturación:
    * Verde fijo / suave: $SpO_2 \ge 95\%$ (Oxigenación normal).
    * Amarillo: $90\% \le SpO_2 \le 94\%$ (Hipoxemia leve / alerta temprana).
    * Rojo intermitente / estroboscópico: $SpO_2 < 90\%$ (Hipoxemia severa / atención urgente).
  - Modo Latido: El primer LED pulsa al ritmo de cada latido detectado.
- [ ] 🟡 **3.3 Procesamiento acústico básico en tiempo real (INMP441):**
  - Implementar cálculo de energía RMS (*Root Mean Square*) del búfer I2S para detectar accesos de tos.
  - Implementar un medidor de intensidad sonora (VU-Meter) reflejado en la barra Neopixel durante la respiración o tos.
- [ ] 🟡 **3.4 Filtro digital paso-banda para auscultación pulmonar:**
  - Diseñar un filtro digital IIR o FIR (pasa-banda $100\text{ Hz} - 2000\text{ Hz}$) en el ESP32 para eliminar ruidos mecánicos de baja frecuencia (<50 Hz) y ruidos parásitos de alta frecuencia.

---

## Fase 4: Inteligencia Artificial y Clasificación Acústica (Avanzado)
*Objetivo: Dotar al dispositivo de capacidad predictiva sobre patologías respiratorias o cardíacas.*

- [ ] 🟡 **4.1 Extracción de características en Python:**
  - Extraer coeficientes MFCC (Mel-Frequency Cepstral Coefficients), energía en bandas críticas y cruces por cero (ZCR) de los audios de PhysioNet 2016 e ICBHI 2017.
- [ ] 🟡 **4.2 Entrenamiento de modelo de clasificación:**
  - Entrenar un clasificador ligero (Random Forest, SVM o una Red Convolucional 1D/2D) para distinguir entre:
    * Caso A: Sonidos cardíacos Normales vs. Anormales (PhysioNet).
    * Caso B: Presencia de sibilancias/estertores vs. respiración normal (ICBHI).
- [ ] 🟢 **4.3 Implementación TinyML (TensorFlow Lite for Microcontrollers):**
  - Cuantizar el modelo a `int8` y compilarlo dentro del firmware del ESP32 para inferencia local directamente en el dispositivo.

---

## Fase 5: Despliegue en Servidor Mac Studio e Integración de Telemetría e IA
*Objetivo: Configurar el nodo central en la Apple Mac Studio y comunicar el ESP32, el Backend y la App Móvil.*

- [ ] 🔴 **5.1 Configuración del entorno de backend en la Mac Studio:**
  - Clonar/sincronizar el repositorio en la Mac Studio.
  - Instalar dependencias en Python (`pip install -r Backend/requirements.txt openpyxl matplotlib`).
  - Ejecutar el servidor FastAPI (`python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload`).
- [ ] 🔴 **5.2 Despliegue de Ollama con LLaMA 3.2 3B en la Mac Studio:**
  - Iniciar el contenedor de Ollama (`docker compose up -d ollama` o instalación nativa en macOS).
  - Descargar y verificar el modelo `llama3.2:3b` aprovechando la aceleración de hardware de Apple Silicon.
  - Probar la respuesta del asistente en `POST /api/ai/chat`.
- [x] 🟡 **5.3 Integración del modelo de IA entrenado en `ai_engine.py`:**
  - Exportar el modelo de clasificación respiratoria entrenado en nuestro repo (`models/mejor_clasificador_icbhi.joblib` y `modelo_icbhi_exportado.json`). *(Completado: integrado en `FeriaTecnologica2026/Backend/ai_engine.py` y `main.py` con soporte para clasificación acústica y contexto en LLM Ollama)*.
- [ ] 🟡 **5.4 Configuración de túnel seguro público en la Mac Studio (Acceso Remoto):**
  - Instalar y configurar un túnel persistente (**Cloudflare Tunnel / `cloudflared`** o **ngrok**) en la Mac Studio apuntando al puerto local 8000 (`http://localhost:8000`).
  - Obtener una URL pública HTTPS/WSS segura (ejemplo: `https://spiroscan-api.dominio.com`).
- [ ] 🟡 **5.5 Enlace por Internet en el Stand de la Feria (ESP32 -> Mac Studio Remota -> App Móvil):**
  - Configurar un punto de acceso a Internet en el evento (Wi-Fi del recinto o *hotspot* 4G/5G desde celular).
  - Configurar la URL pública del túnel en la App Móvil (`EXPO_PUBLIC_API_URL`) y en el script `gateway.py` (`BACKEND_URL`).
  - Probar la transmisión continua de telemetría y el chat con el LLM LLaMA 3.2 a través de Internet.

---

## Fase 6: Diseño Mecánico, Acoplamiento Acústico y Carcasa
*Objetivo: Convertir el circuito de laboratorio en un producto ergonómico y funcional.*

- [ ] 🟡 **6.1 Diseño 3D de la campana de auscultación para el INMP441:**
  - Modelar una campana tipo estetoscopio (forma cónica o hiperbólica) en software CAD para acoplar la membrana al micrófono INMP441, maximizando la transferencia de presión acústica desde el tórax y bloqueando el ruido ambiente.
- [ ] 🟢 **6.2 Diseño de carcasa ergonómica para el dispositivo:**
  - Alojar el ESP32, la batería, la placa TP4056, el interruptor y la barra de LEDs con una ventana difusora para que la luz sea visible sin encandilar.

---

## Fase 7: Validación Experimental y Documentación Académica
*Objetivo: Cuantificar la precisión del dispositivo y redactar el reporte formal de la materia.*

- [ ] 🟡 **7.1 Pruebas de contraste y calibración:**
  - Comparar las lecturas de $SpO_2$ y BPM obtenidas por el prototipo frente a un oxímetro de pulso comercial certificado (tipo dedo).
  - Calcular el error absoluto medio (MAE) y el coeficiente de correlación de Pearson.
- [ ] 🟢 **7.2 Pruebas de usabilidad y autonomía de batería:**
  - Medir el consumo de corriente en miliamperios (mA) en modo reposo y en modo adquisición activa con LEDs encendidos para estimar la duración de la batería.
- [ ] 🟢 **7.3 Redacción del informe final / memoria técnica de "f tecno":**
  - Documentar la metodología, diagramas esquemáticos, resultados de pruebas, discusión clínica y conclusiones del proyecto.

