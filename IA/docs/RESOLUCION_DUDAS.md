# GUÍA Y RESOLUCIÓN DE DUDAS DEL PROYECTO
> **Propósito:** Documento de consulta continua en lenguaje claro, pedagógico y directo.  
> **Uso:** Resolver dudas conceptuales, arquitectónicas y clínicas de forma incremental antes y durante el desarrollo técnico, citando los archivos del repositorio donde se profundiza cada aspecto.  
> **Última actualización:** Octubre 2026  

---

## Índice de Dudas Resueltas
1. [¿Los datos que tenemos ya fueron usados para Machine Learning? ¿Qué significa "datos validados"?](#1-los-datos-que-tenemos-ya-fueron-usados-para-machine-learning-qué-significa-datos-validados)
2. [¿Qué es lo que estaríamos logrando? (El flujo completo del sistema de punta a punta)](#2-qué-es-lo-que-estaríamos-logrando-el-flujo-completo-del-sistema-de-punta-a-punta)
3. [Resumen conceptual de los diagnósticos con los que podremos trabajar](#3-resumen-conceptual-de-los-diagnósticos-con-los-que-podremos-trabajar)
4. [Diferencia entre Machine Learning Clásico y Deep Learning para lo que podríamos hacer](#4-diferencia-entre-machine-learning-clásico-y-deep-learning-para-lo-que-podríamos-hacer)
5. [¿Cómo interactúa nuestro repositorio con el repositorio del compañero (`FeriaTecnologica2026`)?](#5-cómo-interactúa-nuestro-repositorio-con-el-repositorio-del-compañero-feriatecnologica2026)

---

## 1. ¿Los datos que tenemos ya fueron usados para Machine Learning? ¿Qué significa "datos validados"?

### A. ¿Ya fueron usados para Machine Learning?
Hay dos niveles para responder a esto:

1. **A nivel mundial / científico (SÍ):**  
   Los datasets que tenemos en la carpeta `data/` (**PhysioNet / CinC Challenge 2016** para corazón e **ICBHI 2017 Challenge** para pulmones) son dos de los retos públicos más famosos y prestigiosos del mundo en ingeniería biomédica. Cientos de universidades y centros de investigación han entrenado modelos de inteligencia artificial con ellos y han publicado artículos científicos demostrando su utilidad.
2. **En nuestro proyecto específico (TODAVÍA NO):**  
   En nuestro repositorio, los datos están **100% descargados, auditados, vinculados y organizados** en carpetas de pacientes dentro de `data/` (completamos con éxito la Fase 2), pero **aún no hemos ejecutado ningún script de entrenamiento sobre ellos**. La etapa de entrenamiento de modelos corresponde a la **Fase 4** descrita en el plan de trabajo.

### B. ¿Qué significa "datos validados"?
El término "validado" tiene dos significados cruciales en este proyecto:

* **1. Validación médica / clínica (Calidad de la etiqueta o *Ground Truth*):**  
  Significa que las grabaciones **no son ruidos al azar de internet**, sino audios grabados en hospitales por personal médico calificado utilizando estetoscopios clínicos y sensores certificados. Cada audio fue revisado y etiquetado por doctores especialistas que confirmaron el diagnóstico real del paciente mediante pruebas de referencia (como espirometría, radiografías de tórax o tomografías).
* **2. Validación en Machine Learning (El conjunto de prueba / Test):**  
  Para saber si un modelo de IA realmente aprendió o si simplemente "memorizó" los datos (sobreajuste o *overfitting*), la base de datos se divide en dos partes:
  * **Entrenamiento (*Training*):** Audios con los que el algoritmo practica y ajusta sus parámetros.
  * **Validación (*Validation* / *Test*):** Audios de **pacientes completamente nuevos** que el modelo nunca ha visto. Si el modelo acierta en estos audios no vistos, se dice que el modelo está *validado* y es capaz de generalizar en la vida real.  
  *Por eso en la carpeta [data/validation - pruebas realizadas](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/data/validation%20-%20pruebas%20realizadas/) tenemos 301 audios cardíacos reservados exclusivamente para esta evaluación final.*

> 📂 **Archivos del repositorio donde se documenta esto en detalle:**
> * [docs/RESUMEN_DATOS.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/RESUMEN_DATOS.md): Inventario completo de los 3,541 audios de PhysioNet y los 126 pacientes de ICBHI.
> * [INSTRUCCIONES_DATOS_IA.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/INSTRUCCIONES_DATOS_IA.md#L21-L68): Sección 2 y Sección 3.3 ("Partición de Datos Libre de Fugas").
> * [docs/AVANCES_PROYECTO.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/AVANCES_PROYECTO.md#L61-L93): Hitos 4 y 6 (descarga, organización y verificación de pares audio/anotación).

---

## 2. ¿Qué es lo que estaríamos logrando? (El flujo completo del sistema de punta a punta)

En palabras sencillas: **estamos construyendo un dispositivo médico portátil e inteligente que evalúa la salud cardiorrespiratoria de una persona combinando luz y sonido.**

En lugar de requerir un pulsioxímetro por separado y que un médico escuche con un estetoscopio tradicional, nuestro sistema reúne ambas funciones en un solo equipo que procesa las señales y da una respuesta clara e inmediata.

```
 PACIENTE
    │
    ├── [Canal Óptico: Dedo] ────► Sensor MAX30102 (Luz Roja e Infrarroja) ──┐
    │                                                                        │
    └── [Canal Acústico: Pecho] ──► Micrófono INMP441 (Audio Digital I2S) ────┤
                                                                             │
                                                                             ▼
                                                               ┌───────────────────────────┐
                                                               │      Cerebro: ESP32       │
                                                               │  (Filtra ruido + Procesa) │
                                                               └─────────────┬─────────────┘
                                                                             │
                                                                             ▼
                                                               ┌───────────────────────────┐
                                                               │       Evaluación / IA     │
                                                               │  - Oxigenación (%SpO2)    │
                                                               │  - Ritmo Cardíaco (FC)    │
                                                               │  - Ruidos Pulmonares/Tos  │
                                                               └─────────────┬─────────────┘
                                                                             │
                                                                             ▼
                                                               ┌───────────────────────────┐
                                                               │      Respuesta Visual     │
                                                               │   Semáforo LED Neopixel   │
                                                               │   (Verde / Amarillo /     │
                                                               │    Rojo de Alerta Médica) │
                                                               └───────────────────────────┘
```

### Las 4 etapas del flujo:

1. **Captura Física (El cuerpo transmite):**
   * El paciente apoya el dedo en el sensor óptico **MAX30102**. La luz atraviesa el torrente sanguíneo para medir la saturación de oxígeno ($SpO_2$) y cada pulso cardíaco.
   * El paciente o examinador coloca el micrófono digital **INMP441** en el pecho o cuello. Este sensor captura las ondas sonoras de la respiración, los latidos y los accesos de tos.
2. **Acondicionamiento y Limpieza (El ESP32 elimina el ruido):**
   * El microcontrolador ESP32 recibe los datos en formato digital puro (sin ruido de cables analógicos).
   * Aplica filtros matemáticos para eliminar el roce de la mano, los temblores del cuerpo y ruidos eléctricos de baja frecuencia.
3. **Análisis e Inteligencia (Cálculo y Detección):**
   * **Cálculo de Signos Vitales:** Estima el $\%SpO_2$ (oxígeno en sangre) y la frecuencia cardíaca en pulsaciones por minuto.
   * **Análisis Acústico:** Evalúa si la respiración es limpia o si presenta anomalías (silbidos agudos de asma, burbujeo de neumonía, o soplos en el corazón).
4. **Respuesta y Alerta (Lo que ve el usuario):**
   * **Nivel Base (Inmediato en el hardware):** La barra de 8 LEDs Neopixel opera como semáforo de triaje clínico rápido:
     * 🟢 **Verde:** Parámetros normales ($SpO_2 \ge 95\%$, sonido limpio).
     * 🟡 **Amarillo:** Alerta preventiva ($SpO_2$ entre $90-94\%$ o presencia de tos/ruido leve).
     * 🔴 **Rojo:** Emergencia / Hipoxemia ($SpO_2 < 90\%$ o alteración severa).
     * Un LED palpita al ritmo de cada latido del paciente.
   * **Capa de Conectividad y Servidor Remoto:** El dispositivo transmite por Bluetooth hacia el celular o laptop Gateway, y desde allí viaja por **Internet (Wi-Fi o 4G/5G)** a través de un túnel seguro (Cloudflare / ngrok) hacia un **Apple Mac Studio** ubicado en un sitio remoto. La Mac Studio ejecuta el backend FastAPI, la base de datos persistente SQLite y los modelos de IA (incluyendo el asistente médico Ollama LLaMA 3.2).
   * **Visualización Médica Avanzada:** Una **App Móvil (React Native)** se conecta en tiempo real al Mac Studio y al ESP32 para mostrar curvas de pulso, monitoreo hospitalario, historial de tendencias y descargar reportes clínicos (PDF/Excel).


> 📂 **Archivos del repositorio donde se documenta esto en detalle:**
> * [INSTRUCCIONES_PROYECTO.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/INSTRUCCIONES_PROYECTO.md#L18-L44): Sección 2 ("Enfoque Actual y Filosofía de Diseño Modular: A. Base de captura, B. Posibles implementaciones").
> * [Objetivo.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/Objetivo.md): Objetivos generales y específicos del sistema embebido.
> * [docs/AVANCES_PROYECTO.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/AVANCES_PROYECTO.md#L23-L31): Hito 1 (Conceptualización del sistema híbrido óptico + acústico).

---

## 3. Resumen conceptual de los diagnósticos con los que podremos trabajar

Contamos con datos de dos órganos fundamentales: **pulmones (ICBHI 2017)** y **corazón (PhysioNet 2016)**. A continuación se resume qué significa cada patología y qué sonido produce:

### A. Diagnósticos Respiratorios (Dataset ICBHI - 126 pacientes)

| Diagnóstico Clínico | Pacientes | ¿Qué le pasa al paciente en palabras simples? | ¿Qué sonido o signo físico produce? |
| :--- | :---: | :--- | :--- |
| **COPD / EPOC** *(Enfermedad Pulmonar Obstructiva Crónica)* | **64** (50.8%) | Los bronquios están inflamados y los alvéolos destruidos (típico de fumadores o exposición prolongada a humo de leña). Al paciente le cuesta mucho expulsar el aire. | **Sibilancias** frecuentes (silbidos), reducción del murmullo normal y tendencia a desaturación de oxígeno ($SpO_2$ baja). |
| **Healthy** *(Sanos)* | **26** (20.6%) | Personas sin patología pulmonar. Es el grupo de referencia o control. | Respiración limpia, suave y continua ("murmullo vesicular"), sin silbidos ni crujidos. |
| **URTI** *(Infección de Vías Superiores)* | **14** (11.1%) | Resfriado común, faringitis, laringitis. La infección está en nariz, garganta o tráquea alta, no en los pulmones profundos. | Pulmones mayormente despejados; ruidos ásperos en garganta o tos seca/irritativa. |
| **Bronchiectasis** *(Bronquiectasias)* | **7** (5.6%) | Las vías bronquiales están permanentemente ensanchadas y deformadas, acumulando flema espesa que no se puede drenar fácilmente. | **Crepitantes húmedos** abundantes (como burbujeo constante) y accesos de tos productiva. |
| **Pneumonia** *(Neumonía)* | **6** (4.8%) | Infección bacteriana o viral aguda que llena los sacos de aire (alvéolos) de líquido y pus. | **Crepitantes finos y secos** (suena como frotar un mechón de pelo cerca de la oreja o pisar nieve fresca) y caída rápida de $SpO_2$. |
| **Bronchiolitis** *(Bronquiolitis)* | **6** (4.8%) | Inflamación viral de los conductos más pequeños del pulmón; se presenta casi exclusivamente en **bebés y niños pequeños**. | Respiración rápida, silbidos agudos y esfuerzo visible para meter aire. |
| **LRTI** *(Infección de Vías Bajas)* | **2** (1.6%) | Infección aguda grave debajo de las cuerdas vocales (como una bronquitis aguda severa). | Ronquidos bronquiales ásperos y tos profunda. |
| **Asthma** *(Asma)* | **1** (0.8%) | Enfermedad reactiva donde los bronquios se cierran en espasmo súbito ante alergias, ejercicio o frío. | **Sibilancias musicales muy agudas** (silbido claro al espirar el aire). |

#### Los dos "sonidos elementales" que la IA busca en el pulmón:
Independientemente del nombre de la enfermedad, los neumólogos identifican dos anomalías acústicas principales:
1. **Crepitantes (*Crackles*):** Ruidos cortos y discontinuos, como pequeñas explosiones o burbujas que se revientan. Aparecen cuando se despegan alvéolos pegados por líquido (neumonía, bronquiectasias).
2. **Sibilancias (*Wheezes*):** Silbidos continuos de tono musical agudo. Aparecen cuando el aire es forzado a pasar por un tubo bronquial estrecho o inflamado (asma, EPOC).

---

### B. Diagnósticos Cardíacos (Dataset PhysioNet - 3,541 grabaciones)

El análisis del fonocardiograma (sonido del corazón) se divide en dos grandes grupos:

* **Normal (`-1`):**  
  El corazón produce sus dos tonos clásicos limpios: **"Tum - Ta"** ($S_1$ y $S_2$, cierre de válvulas auriculoventriculares y sigmoideas). Entre latido y latido hay silencio completo.
* **Anormal (`1`):**  
  Aparecen ruidos parásitos adicionales, principalmente **soplos cardíacos (*murmurs*)**. Un soplo es un siseo o sonido de turbulencia (como agua saliendo a presión por una manguera doblada) causado porque una válvula cardíaca no abre bien (estenosis) o no cierra herméticamente y deja fugar sangre (insuficiencia).

> 📂 **Archivos del repositorio donde se documenta esto en detalle:**
> * [docs/RESUMEN_DATOS.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/RESUMEN_DATOS.md#L41-L87): Tablas clínicas oficiales de distribución por paciente y por tipo de sonido.
> * [INSTRUCCIONES_DATOS_IA.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/INSTRUCCIONES_DATOS_IA.md#L110-L126): Sección 5.1 ("Tareas Clínicas de Clasificación Definidas").

---

## 4. Diferencia entre Machine Learning Clásico y Deep Learning para lo que podríamos hacer

Ambas son ramas de la Inteligencia Artificial, pero abordan el análisis del audio de forma totalmente distinta:

```
                            ¿CÓMO ANALIZAN EL SONIDO?

[ MACHINE LEARNING CLÁSICO ]
  Audio .wav ──► [El Ingeniero extrae características manuales] ──► Tabla de números ──► Clasificador (Random Forest/SVM)
                 (Energía RMS, frecuencias promedio, MFCCs)       (10 a 50 valores)      (Rápido, liviano, cabe en ESP32)

[ DEEP LEARNING ]
  Audio .wav ──► [Convertir a "Foto" del sonido] ──► Espectrograma Mel ──► Red Neuronal Convolucional (CNN)
                 (Frecuencia vs Tiempo en 2D)        (Matriz / Imagen)     (Aprende sola los patrones visuales del sonido)
```

### Tabla Comparativa Práctica

| Criterio | Machine Learning Clásico (SVM, Random Forest, KNN) | Deep Learning (Redes Neuronales, CNNs, Transformers) |
| :--- | :--- | :--- |
| **¿Cómo funciona?** | Nosotros como ingenieros le decimos qué medir: calculamos fórmulas matemáticas (ej. cuántos cruces por cero tiene el audio, cuánta energía tiene en agudos vs graves). Esos números se ingresan a una tabla. | Le entregamos el audio casi en crudo o transformado en una "imagen espectral" (espectrograma Mel). La red neuronal descubre por sí misma qué patrones distinguen a un paciente enfermo de uno sano. |
| **Poder de procesamiento necesario** | **Muy bajo.** Se puede entrenar en segundos en cualquier laptop básica. | **Alto.** Requiere entrenamiento prolongado, preferentemente con tarjeta gráfica (GPU). |
| **Viabilidad para meterlo al ESP32** | **Excelente.** El modelo ocupa unos pocos kilobytes de memoria y el cálculo es casi instantáneo. | **Posible pero exigente (TinyML).** Requiere comprimir y cuantizar el modelo (TensorFlow Lite para Microcontroladores) para no agotar la RAM del ESP32. |
| **Explicabilidad médica** | **Alta.** Le puedes explicar al médico con claridad: *"Se detectó sibilancia porque la energía entre 400 y 800 Hz superó cierto umbral"*. | **Baja ("Caja negra").** La red tiene millones de multiplicaciones internas y es difícil saber exactamente qué detalle del sonido activó la alarma. |
| **Precisión en tareas complejas** | Buena para clasificaciones sencillas (Sano vs Anormal), pero se queda corta con sonidos sutiles. | **Estado del arte (SOTA).** Es lo que gana las competencias mundiales actuales porque detecta patrones acústicos que ninguna fórmula manual puede capturar. |

### ¿Qué camino nos conviene seguir en este proyecto?
La mejor estrategia es la **aproximación progresiva en dos etapas** (planteada en las instrucciones de IA):

1. **Paso 1 (Garantizar la base práctica):**  
   Comenzar con **procesamiento de señales clásico y Machine Learning liviano** (o reglas clínicas directas: umbrales de energía RMS para tos, bandas de frecuencia para sibilancias y ratio óptico para $SpO_2$). Esto garantiza tener un prototipo embebido funcionando en el ESP32 sin bloqueos de memoria.
2. **Paso 2 (Exploración científica / IA avanzada):**  
   En la computadora (Python), entrenar una **Red Convolucional (CNN)** con los audios de ICBHI y PhysioNet para comparar el rendimiento. Si los resultados son sobresalientes, se puede aplicar TinyML para intentar trasladar una versión miniatura al ESP32.

> 📂 **Archivos del repositorio donde se documenta esto en detalle:**
> * [INSTRUCCIONES_DATOS_IA.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/INSTRUCCIONES_DATOS_IA.md#L81-L105): Sección 4.2 (Diagrama de representaciones 2D vs vectores 1D tabulares).
> * [INSTRUCCIONES_DATOS_IA.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/INSTRUCCIONES_DATOS_IA.md#L128-L137): Sección 5.2 ("Estrategia de Modelado Progresivo": Niveles 1 a 4).
> * [INSTRUCCIONES_PROYECTO.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/INSTRUCCIONES_PROYECTO.md#L35-L37): Sección 2.B (Implementación 2: Estetoscopio digital con TinyML).

---

## 5. ¿Cómo interactúa nuestro repositorio con el repositorio del compañero (`FeriaTecnologica2026`)?

### A. Diagnóstico del Repositorio del Compañero
Tras inspeccionar el repositorio [`FeriaTecnologica2026`](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/FeriaTecnologica2026), se identificó que su enfoque está centrado en la **Infraestructura de Despliegue, Conectividad IoT y Experiencia de Usuario**:

1. **`App Movil/`:** Aplicación móvil en React Native / Expo (SDK 58) con interfaz médica tipo monitor hospitalario ECG, gráficas de tendencias históricas, asistente virtual conversacional y exportación de informes clínicos (PDF, Excel, CSV).
2. **`Backend/`:** Servidor en Python (FastAPI + SQLite en modo WAL) **desplegado en una Apple Mac Studio** (servidor central de alta velocidad en red local), que expone endpoints REST (`/api/telemetry`, `/api/vitals/current`), canales WebSocket (`/ws/live`) y un contenedor Docker con **Ollama (LLaMA 3.2 3B)** para responder preguntas clínicas del usuario con latencia mínima.
3. **`Esp32/`:** Firmware de producción para ESP32 (`Esp32.ino`) con soporte para Bluetooth Serial SPP / BLE dual, consola USB y envío HTTP hacia el backend.
4. **`Emulador/`:** Entorno de simulación virtual en **Wokwi** (`diagram.json`) y scripts de generación de datos fisiológicos para pruebas en PC sin requerir hardware físico conectado.
5. **`gateway.py`:** Puente universal en Python para capturar datos por puerto COM (USB o Bluetooth virtual) y remitirlos por HTTP al backend en la Mac Studio.

### B. La Sinergia: ¿Por qué encajan como dos piezas de un rompecabezas?

Ambos proyectos no compiten, sino que **se complementan exactamente**:

```
 ┌────────────────────────────────────────────────────────┐
 │           NUESTRO REPOSITORIO (code/)                  │
 │           "El Cerebro Clínico y Científico"            │
 ├────────────────────────────────────────────────────────┤
 │ • 126 pacientes y 920 audios de ICBHI 2017 (Pulmón).   │
 │ • 3,541 registros de PhysioNet 2016 (Corazón).         │
 │ • Preprocesamiento médico (filtros paso-banda, MFCCs). │
 │ • Modelos de clasificación (EPOC, Neumonía, Sibilancias│
 │   Crepitantes y Soplos Cardíacos).                     │
 └──────────────────────────┬─────────────────────────────┘
                            │  Alimenta con algoritmos,
                            │  modelos y validación real
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │       REPOSITORIO DEL COMPAÑERO (FeriaTecnologica2026/)│
 │       "La Infraestructura de Despliegue y Telemedicina"│
 ├────────────────────────────────────────────────────────┤
 │ • App Móvil con Dashboard tipo monitor ECG.            │
 │ • Backend FastAPI + SQLite + WebSockets en vivo.       │
 │ • Docker con LLM LLaMA 3.2 para explicar diagnósticos. │
 │ • Firmware ESP32 con BLE, ahorro de energía y Wokwi.   │
 │ • Exportación de informes médicos (PDF / Excel).       │
 └────────────────────────────────────────────────────────┘
```

* **Lo que le falta al proyecto del compañero:**  
  Actualmente, su sistema de análisis médico en [`Backend/ai_engine.py`](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/FeriaTecnologica2026/Backend/ai_engine.py) utiliza **reglas heurísticas muy básicas** (ejemplo: `if hr > 110: Taquicardia; if spo2 < 90: Hipoxemia`), y la señal del micrófono INMP441 solo calcula el volumen en decibeles (RMS) para inventar un "índice de estrés", sin detectar patologías respiratorias reales ni soplos cardíacos.
* **Lo que nuestro repositorio aporta:**  
  Nosotros aportamos la **inteligencia biomédica real**: datos clínicos certificados internacionalmente, algoritmos para identificar sibilancias y crepitantes en los audios pulmonares y modelos entrenados que pueden predecir si un paciente tiene EPOC o neumonía.

---

### C. Los 4 Puntos Concretos de Interacción Técnica

#### 1. Integración en el Backend: Potenciar `ai_engine.py` con nuestros modelos de IA
* **Cómo interactúan:**  
  En lugar de que el endpoint `POST /api/ai/vitals/analyze` del backend dependa de simples `if/else`, podemos exportar nuestros modelos entrenados en Python (ej. `modelo_respiratorio.pkl` o una red neuronal en ONNX/PyTorch) y cargarlos en `ai_engine.py`.
* **Resultado:**  
  Cuando el backend reciba el audio o las características del paciente, nuestro modelo generará un diagnóstico patológico riguroso (ej. *"92% de probabilidad de patrón obstructivo / EPOC"*), y ese resultado se le pasará al LLM LLaMA 3.2 de Ollama para que redacte un reporte clínico explicativo impecable en la App Móvil.

#### 2. Enriquecimiento de la Trama de Telemetría del ESP32
* **Cómo interactúan:**  
  El firmware del compañero actualmente transmite esta trama JSON:
  ```json
  {"bpm": 75, "spo2": 97.2, "audio_rms": 45.2, "systolic": 118, "diastolic": 76}
  ```
  Con los filtros y algoritmos livianos que estamos desarrollando en nuestro repositorio, podemos enriquecer la trama agregando banderas acústicas diagnósticas:
  ```json
  {
    "bpm": 75, 
    "spo2": 97.2, 
    "audio_rms": 45.2,
    "sibilancia_detectada": true,
    "crepitante_detectado": false,
    "soplo_cardiaco": false,
    "eventos_tos": 2
  }
  ```
* **Resultado:**  
  Tanto la App Móvil como el Backend registrarán eventos acústicos respiratorios reales en tiempo real sin modificar su arquitectura base.

#### 3. Unificación del Pinout Físico del ESP32 (Punto Crítico de Coordinación)
Existe una ligera discrepancia de pines entre la recomendación inicial de nuestro repositorio y el firmware/Wokwi del compañero que debemos homologar:

| Señal / Periférico | Pin en Nuestro Repositorio (Teórico) | Pin en Repo Compañero (Firmware y Wokwi) | Recomendación de Unificación |
| :--- | :--- | :--- | :--- |
| **MAX30102 SDA** | GPIO 21 | GPIO 21 (o 23) | **GPIO 21** (Estándar nativo ESP32) |
| **MAX30102 SCL** | GPIO 22 | GPIO 22 | **GPIO 22** (Estándar nativo ESP32) |
| **INMP441 SD (Data)** | GPIO 32 | GPIO 32 | **GPIO 32** (Coincide perfectamente) |
| **INMP441 SCK (Clock)** | GPIO 26 | GPIO 14 | **GPIO 14** (Para coincidir con su Wokwi y PCB) |
| **INMP441 WS (Word Select)** | GPIO 25 | GPIO 15 | **GPIO 15** (Para coincidir con su Wokwi y PCB) |
| **Neopixel DIN** | GPIO 4 | GPIO 25 | **GPIO 25** (Adoptar el del firmware/Wokwi) |
| **Botón K1 (Modos/Wake)** | No contemplado | GPIO 17 | **GPIO 17** (Aprovecharlo para control de modos) |

> ⚠️ **Acuerdo de equipo:** Conviene adoptar la asignación de pines del repositorio del compañero (`SCK=14, WS=15, SD=32, Neopixel=25, Botón=17`) porque su emulador Wokwi y su firmware físico ya están compilados y cableados con esa configuración.

#### 4. Inyección de Datos Clínicos Reales para Pruebas y Demos de la Feria
* **Cómo interactúan:**  
  Podemos usar las 920 grabaciones de ICBHI y los 3,541 audios de PhysioNet de nuestra carpeta `data/` para alimentar el script `gateway.py` o el simulador.
* **Resultado:**  
  Durante la feria o la presentación académica, se puede reproducir un caso clínico real (por ejemplo, el audio del Paciente 104 con EPOC severo) y demostrar en vivo cómo la App Móvil del compañero enciende las alertas, muestra el semáforo rojo y el asistente de IA explica detalladamente la patología.

#### 5. Nodo Central de Cómputo: Despliegue Remoto del Backend en Apple Mac Studio
* **Ubicación Física y Requerimiento de Internet:**  
  La **Apple Mac Studio estará ubicada en una locación remota** (laboratorio o domicilio) y **no** en la misma red local física del stand de la feria. Por lo tanto, **se requiere conexión a Internet** tanto en la Mac Studio como en el stand de la feria.
* **Cómo se comunican a través de Internet:**  
  1. **Túnel Seguro de Exposición:** La Mac Studio ejecuta el backend FastAPI (puerto 8000) y un servicio de túnel como **Cloudflare Tunnel (`cloudflared`)** o **ngrok** que le asigna una URL pública segura (ejemplo: `https://spiroscan-api.tunel.com`).
  2. **Tráfico en el Stand:** En el stand, el teléfono móvil (con la App SpiroScan) o la laptop con el Gateway se conectan al ESP32 vía Bluetooth, y utilizan los datos móviles (4G/5G) o la red Wi-Fi con Internet para enviar la telemetría y consultar el LLM a través de dicha URL pública.
* **Beneficios de esta arquitectura:**  
  1. **Aprovechar la potencia de la Mac Studio:** No es necesario transportar físicamente la Mac Studio al evento. Su procesador Apple Silicon M-series y su memoria unificada ejecutan Ollama LLaMA 3.2 3B y FastAPI de forma continua y segura desde su ubicación fija.
  2. **Tolerancia a cortes de red:** Si la red de internet en el evento llega a presentar intermitencias, el **semáforo de triaje Neopixel en el ESP32 no se detiene**, ya que las mediciones de pulso, $SpO_2$ y ruidos pulmonares se evalúan en tiempo real en el circuito integrado.



