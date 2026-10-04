# 🩺 SpiroScan AI / VitalSync — Monitor Cardiorrespiratorio IoT con IA

> **Estado verificado (3 de octubre de 2026):** valoración orientativa con síntomas y datos válidos. La SpO2 del firmware permanece no disponible hasta implementar y validar su calibración; se eliminaron valores fabricados. El descriptor de soplos está desactivado por contaminación en la evaluación. No hay CNN pulmonar entrenada disponible. Consulte [el informe de cambios y límites](docs/INFORME_MEJORAS_2026-10-03.md) antes de usar métricas o descripciones históricas de este README.


> **Proyecto:** Sistema Embebido para Captura y Análisis de Señales Cardiorrespiratorias  
> **Asignatura / Evento:** *f tecno* — Feria Tecnológica 2026 (8vo Semestre)  
> **Arquitectura:** Dispositivo Embebido (ESP32) + Backend Clínico (FastAPI + ML) + LLM Médico (Ollama LLaMA 3.2) + App Móvil / Web (React Native Expo).

---

## 📌 1. Descripción General del Sistema

**SpiroScan AI** es una plataforma médica de telemetría y triaje biomédico en tiempo real. Integra sensores ópticos (fotopletismografía PPG y oximetría $SpO_2$) y un micrófono digital MEMS para auscultación torácica y análisis acústico respiratorio mediante modelos de Inteligencia Artificial (clasificación de ruidos patológicos como sibilancias y crepitantes bajo el estándar internacional ICBHI 2017).

```
┌─────────────────────────────────┐
│     DISPOSITIVO EMBEBIDO        │
│          (ESP32)                │
│  - MAX30102 (SpO2 / BPM)        │
│  - INMP441 (Audio digital I2S)  │
│  - WS2812 Neopixel (Triaje LED) │
│  - Botón K1 (GPIO 17)           │
└───────────────┬─────────────────┘
                │ Bluetooth SPP / Serial
                ▼
┌─────────────────────────────────┐        WebSocket / REST
│    APP MÓVIL / WEB (EXPO)       │ ──────────────────────────────┐
│  - Monitor ECG a 60 FPS         │                               │
│  - Gráficas y Métricas en vivo  │                               ▼
│  - Chat con Asistente Médico IA │                 ┌───────────────────────────┐
└─────────────────────────────────┘                 │      BACKEND FASTAPI      │
                                                    │  - Motor de IA Acústica   │
                                                    │  - Pipeline ICBHI 2017    │
                                                    │  - SQLite (WAL)           │
                                                    └─────────────┬─────────────┘
                                                                  │ HTTP Local / Docker
                                                                  ▼
                                                    ┌───────────────────────────┐
                                                    │    OLLAMA (LLaMA 3.2 3B)  │
                                                    │   Diagnóstico Explicativo │
                                                    └───────────────────────────┘
```

---

## 📂 2. Estructura del Repositorio

El repositorio está organizado en módulos desacoplados y autocontenidos:

| Carpeta / Archivo | Descripción |
| :--- | :--- |
| **`App Movil/`** | Frontend multiplataforma en **React Native / Expo** (Android, iOS y Web). Incluye monitor hospitalario a 60 FPS, chat médico y tarjetas de diagnóstico en vivo. |
| **`Backend/`** | Servidor **FastAPI** en Python. Gestiona la telemetría, el almacenamiento SQLite en modo WAL, el modelo de inferencia acústica ICBHI (`ai_engine.py`) y conexión con Ollama. |
| **`Esp32/`** | Firmware oficial en C++/Arduino para el hardware físico final. Soporta Bluetooth Serial `SpiroScan-Band`, I2C (MAX30102), I2S (INMP441) y semáforo Neopixel. |
| **`Emulador/`** | Entorno de simulación en **Wokwi** (`diagram.json`) y streamers de datos sintéticos en Python (`pc_band_simulator.py`) para pruebas sin hardware físico. |
| **`gateway.py`** | Script puente para capturar datos por Bluetooth / Serial USB y transmitirlos por HTTP/WebSocket al Backend. |
| **`docker-compose.yml`** | Configuración para desplegar el contenedor de **Ollama** con aceleración de hardware. |

---

## ⚡ 3. Guía de Inicio Rápido

### A. Backend (Servidor e Inferencia de IA)

1. **Instalar dependencias de Python:**
   ```bash
   cd Backend
   pip install -r requirements.txt
   ```
2. **Iniciar el servidor FastAPI:**
   ```bash
   # En Windows PowerShell:
   .\run.ps1

   # O directamente con Uvicorn:
   python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```
3. **Acceder a la documentación interactiva:**
   * Abre en tu navegador: **[http://localhost:8000/docs](http://localhost:8000/docs)** (Swagger UI).
   * Endpoint raíz de diagnóstico del sistema: **[http://localhost:8000/](http://localhost:8000/)** (reporta versión y estado del modelo acústico en memoria).

4. **(Opcional) Levantar Ollama para el Asistente LLaMA 3.2:**
   ```bash
   docker compose up -d ollama
   docker exec -it spiroscan-ollama ollama run llama3.2:3b
   ```

---

### B. Frontend (App Móvil y Navegador Web)

1. **Instalar dependencias de Node.js:**
   ```bash
   cd "App Movil"
   npm install
   ```
2. **Configurar la URL del Backend:**
   * Por defecto, la app detecta si estás en `localhost`, LAN local o remoto.
   * Para fijar una URL pública (ej. Render, túnel ngrok o Cloudflare), edita `.env`:
     ```env
     EXPO_PUBLIC_API_URL=https://tu-backend-desplegado.com
     ```
   * O modifícala directamente en `src/config/api.ts`.
3. **Iniciar la aplicación:**
   ```bash
   npx expo start
   ```
   * Presiona **`w`** para abrir la versión **Web** en tu navegador.
   * O escanea el código QR con **Expo Go** en tu dispositivo Android o iOS.

---

### C. Hardware Físico ESP32 (Firmware y Conexiones)

#### Mapa de Pines Homologado

| Componente | Pin del Sensor | Pin ESP32 | Protocolo / Función |
| :--- | :--- | :--- | :--- |
| **MAX30102** | `VCC` / `GND` | **3V3** / **GND** | Alimentación lógica 3.3V |
| | `SDA` / `SCL` | **GPIO 21** / **GPIO 22** | Bus I2C de telemetría cardíaca y SpO2 |
| **INMP441** | `VDD` / `GND` / `L/R` | **3V3** / **GND** / **GND** | Alimentación y canal izquierdo mono |
| | `SCK` / `WS` / `SD` | **GPIO 14** / **GPIO 15** / **GPIO 32** | Bus digital I2S para auscultación |
| **Neopixel WS2812** | `DIN` / `VDD` / `GND` | **GPIO 25** / **VIN (5V/3.7V)** / **GND** | Semáforo de triaje (8 LEDs RGB) |
| **Botón K1** | `Pin 1` / `Pin 2` | **GPIO 17** / **GND** | Pull-up interno para cambio de modo |
| **Alimentación** | `OUT+` $\rightarrow$ Switch $\rightarrow$ `VIN` | **VIN** / **GND** | Celda Li-Ion 3.7V con módulo TP4056 |

#### Carga del Firmware
1. Abre [`Esp32/Esp32.ino`](Esp32/Esp32.ino) en **Arduino IDE** o **PlatformIO**.
2. Instala las librerías: `SparkFun MAX3010x` y `Adafruit NeoPixel`.
3. Selecciona la placa **ESP32 Dev Module** y el puerto COM.
4. Presiona **Subir**. El ESP32 iniciará y transmitirá como dispositivo Bluetooth `SpiroScan-Band`.

---

### D. Modo Simulación sin Hardware (Emulador Wokwi)

Si no cuentas con el circuito físico a la mano:
1. Abre la carpeta `Emulador` en VS Code con la extensión **Wokwi for VS Code** instalada.
2. Abre `Emulador/diagram.json` y presiona `Ctrl+Shift+P` $\rightarrow$ *Wokwi: Start Simulator*.
3. Alternativamente, para alimentar la API con datos simulados realistas:
   ```bash
   python Emulador/pc_band_simulator.py
   ```

---

## 🧠 4. Inteligencia Artificial y Modelo Acústico Integrado

El backend incluye el modelo clínico entrenado con la base de datos internacional **ICBHI 2017 Challenge (Respiratory Sound Database)**:

* **Archivos del Modelo:** Ubicados en `Backend/models/`
  * `mejor_clasificador_icbhi.joblib`: Pipeline completo de Machine Learning (StandardScaler + Logistic Regression L2) evaluado mediante validación cruzada *Patient-Wise* (Score ICBHI: 61.22%).
  * `modelo_icbhi_exportado.json`: Motor autónomo de inferencia matemática (5 KB, 61 coeficientes normalizados) que opera con cero dependencias pesadas.
* **Endpoints Principales de IA:**
  * `POST /api/ai/audio/classify`: Clasifica un vector de características acústicas del tórax retornando `Normal` o `Patológico (Sibilancias/Crepitantes)` con su nivel de certeza estadística.
  * `POST /api/ai/vitals/analyze`: Analiza el conjunto de biosensores y añade el diagnóstico de auscultación a las anomalías clínicas y recomendaciones de salud.
  * `POST /api/ai/chat`: Conecta con el LLM LLaMA 3.2 inyectándole en el prompt el diagnóstico del modelo para respuestas médicas estructuradas.

---

## 🌐 5. Despliegue en la Nube y Túneles Remotos

Para conectar la app móvil desde cualquier lugar durante la feria:
1. **Render / Cloud Hosting:** El archivo `Backend/render.yaml` permite el despliegue automático del backend conectando el repositorio en Render.
2. **Túnel Seguro (Cloudflare Tunnel o ngrok):**
   ```bash
   # En la máquina host con el Backend encendido:
   ngrok http 8000
   # o bien:
   cloudflared tunnel --url http://localhost:8000
   ```
   Copia la URL `https://...` generada en `EXPO_PUBLIC_API_URL` de la App Móvil.
