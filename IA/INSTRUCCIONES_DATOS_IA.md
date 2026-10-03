# INSTRUCCIONES PARA GESTIÓN DE DATOS, ANÁLISIS E INTELIGENCIA ARTIFICIAL
> **Especialidad:** Tratamiento de Señales Biomédicas, Feature Engineering y Clasificación Acústica  
> **Fases de Enfoque:** Fase 2 (Gestión y Curación de Datos Clínicos) y Fase 4 (IA y Clasificación Acústica)  
> **Proyecto:** Sistema Embebido para Captura y Análisis de Señales Cardiorrespiratorias (*f tecno* - 8vo Semestre 2026)

---

## 1. Propósito de este Documento

Este manual establece la **metodología técnica, directrices y mejores prácticas para el tratamiento de datos y el desarrollo de modelos de Inteligencia Artificial** dentro de este repositorio.

Debe ser consultado obligatoriamente por el desarrollador o asistente de IA cuando se trabaje en:
1. Ingesta, limpieza, sincronización y auditoría de bases de datos acústicas y clínicas.
2. Procesamiento digital de señales de audio (filtrado, remuestreo, segmentación de ciclos).
3. Extracción de características (MFCC, espectrogramas Mel, wavelets, parámetros temporales).
4. Entrenamiento, validación y optimización de algoritmos de Machine Learning y Deep Learning.
5. Preparación de modelos para posible despliegue embebido (TinyML).

---

## 2. Inventario y Estado Actual de los Datasets

| Dataset | Señal / Tipo | Registros / Sujetos | Ubicación en Repo | Estado Actual | Tarea Clínica Asociada |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **PhysioNet 2016 Challenge** | Fonocardiograma (PCG) cardíaco | **3,541 audios `.wav`**<br>(3,240 training `a-f` + 301 validation) | [data/training/](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/data/training/) y [data/validation.../](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/data/validation%20-%20pruebas%20realizadas/) | **Completamente disponible en local** con cabeceras `.hea` y etiquetas `.csv`. | Clasificación binaria: **Normal (-1)** vs. **Anormal (1)**. |
| **ICBHI 2017 Challenge** | Auscultación pulmonar / sonidos respiratorios | **126 pacientes**<br>(edades de 0 a 93 años, 8 patologías) | [data/ICBHI_2017_pacientes_filtrable_1.xlsx](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/data/ICBHI_2017_pacientes_filtrable_1.xlsx) y [ICBHI_organizado.../](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/data/ICBHI_organizado%20-%20pacientes%20de%20los%20links%20filtrados/) | **Estructura y metadatos listos**; audios `.wav` pendientes de descarga de Kaggle. | Detección de **sibilancias**, **crepitantes** y diagnóstico patológico. |
| **CirCor DigiScope 2022** | PCG pediátrico multicéntrico | Registros de soplos cardíacos | Referenciado en [links.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/links.md) | Enlace documental de respaldo. | Detección de soplos cardíacos (*Murmurs*). |

---

## 3. Fase 2: Gestión, Curación y Tratamiento de Datos Clínicos

### 3.1 Procedimiento de Descarga y Población de Audios ICBHI 2017
Los metadatos y la jerarquía de carpetas para los 126 pacientes ya están creados en [ICBHI_organizado - pacientes de los links filtrados](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/data/ICBHI_organizado%20-%20pacientes%20de%20los%20links%20filtrados/). Para completar la disponibilidad de los audios:

1. **Descarga desde Kaggle:**
   * URL de origen: `https://www.kaggle.com/datasets/nimalanparameshwaran/icbhi-2017-challenge-respiratory-sound-database`
   * Descargar y descomprimir el archivo que contiene las grabaciones `.wav` y los archivos de anotaciones `.txt`.
2. **Nomenclatura oficial de los archivos de ICBHI:**
   Cada archivo de audio sigue el estándar:
   $$\text{[ID\_Paciente]\_[Indice\_Grabacion]\_[Posicion\_Pecho]\_[Modo\_Aquisicion]\_[Equipo].wav}$$
   *Ejemplo:* `111_1b2_Tc_sc_Meditron.wav` (Paciente 111, grabación 1b2, posición tráquea, mono, estetoscopio Meditron).
3. **Script de Distribución Automática (`organizar_por_categoria.py`):**
   * El script debe leer el ID del paciente al inicio del nombre del archivo y copiar tanto el `.wav` como su correspondiente archivo de anotaciones de ciclos `.txt` en la carpeta `paciente_<id>/audios/`, eliminando el marcador temporal `LEEME.txt`.

### 3.2 Auditoría y Preprocesamiento de Integridad
* **Frecuencias de Muestreo Heterogéneas:**
  * En ICBHI 2017, los dispositivos registraron a diferentes frecuencias ($4\text{ kHz}, 10\text{ kHz}, 44.1\text{ kHz}$).
  * En PhysioNet 2016, las señales están muestreadas a $2\text{ kHz}$.
  * **Regla de oro:** Todo el pipeline de procesamiento debe **estandarizar la frecuencia de muestreo** mediante remuestreo (*resampling* poli-fásico o con `librosa.resample` / `torchaudio.transforms.Resample`). Frecuencias recomendadas:
    * Para sonidos respiratorios: **$4000\text{ Hz}$** o **$16000\text{ Hz}$** (mono).
    * Para sonidos cardíacos: **$1000\text{ Hz}$** o **$2000\text{ Hz}$** (mono).
* **Normalización de Amplitud:**
  * Aplicar normalización por pico o normalización Z-score sobre cada grabación:
    $$x_{norm}(t) = \frac{x(t) - \mu}{\sigma} \quad \text{o} \quad x_{norm}(t) = \frac{x(t)}{\max(|x(t)|) + \epsilon}$$
* **Filtrado Paso-Banda de Calidad Médica:**
  * **Audio Cardíaco (PCG):** Filtro Butterworth pasa-banda de orden 3 o 4 entre **$20\text{ Hz}$ y $200\text{ Hz}$** (elimina componentes de respiración de alta frecuencia y temblores de baja frecuencia).
  * **Audio Respiratorio:** Filtro Butterworth pasa-banda de orden 4 entre **$100\text{ Hz}$ y $2000\text{ Hz}$** (elimina los tonos fundamentales del corazón $S_1/S_2$ que caen bajo 100 Hz y ruidos parásitos de alta frecuencia).

### 3.3 Partición de Datos Libre de Fugas (*Patient-Wise Splitting*)
> ⚠️ **REGLA ESTRICTA CONTRA DATA LEAKAGE:**  
> **Jamás mezclar fragmentos o grabaciones del mismo paciente entre el conjunto de entrenamiento (Train) y el conjunto de prueba (Test).**
> Si un paciente está en entrenamiento, todas sus grabaciones deben quedarse en entrenamiento.

* En **PhysioNet 2016**, utilizar los 6 subsets de `training/` para validación cruzada estratificada por paciente o grupo, y evaluar finalmente sobre la carpeta [validation - pruebas realizadas](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/data/validation%20-%20pruebas%20realizadas/).
* En **ICBHI 2017**, utilizar la partición estándar oficial 60/40 (*Train/Test split* definida por Rocha et al., disponible en los metadatos de cada paciente en la columna `Particion sugerida`).

---

## 4. Segmentación y Extracción de Características (*Feature Engineering*)

### 4.1 Segmentación de Señales
1. **Segmentación Respiratoria por Ciclos:**
   * Utilizar los archivos de texto `.txt` de ICBHI. Cada fila define:
     $$\text{[Inicio\_Ciclo\_seg]} \quad \text{[Fin\_Ciclo\_seg]} \quad \text{[Crackles (0/1)]} \quad \text{[Wheezes (0/1)]}$$
   * Recortar cada ciclo respiratorio individual (duración típica: $1.5\text{ s} - 3.5\text{ s}$).
   * Para alimentar redes neuronales de entrada fija, aplicar *padding* (relleno con ceros) o truncado a una longitud fija estándar (ej. **$4.0\text{ segundos}$**).
2. **Segmentación Cardíaca (Ventanas deslizantes):**
   * En PCG, emplear ventanas móviles de **$3\text{ a }5\text{ segundos}$** con un solapamiento (*overlap*) del **$50\%$**, garantizando abarcar al menos 3 a 5 ciclos cardíacos completos ($S_1 - S_2$).

### 4.2 Extracción de Características Acústicas (Vector de Entrada)

Para análisis con modelos tradicionales (SVM, Random Forest, XGBoost) o redes neuronales:

```
                                 Señal de Audio Filtrada (.wav)
                                               │
                       ┌───────────────────────┴───────────────────────┐
                       ▼                                               ▼
           [ Representaciones 2D ]                         [ Vectores 1D (Tabulares) ]
      (Para CNNs, ResNet, MobileNet)                      (Para SVM, Random Forest, MLP)
                       │                                               │
         ├── Espectrograma Mel (Mel-Spectrogram)         ├── Coeficientes MFCC (Media y Desv. Estándar)
         ├── MFCC 2D (13 a 40 filtros)                   ├── Energía RMS y Zero Crossing Rate (ZCR)
         ├── CWT (Transformada Wavelet Continua)         ├── Centroide Espectral y Spectral Roll-off
         └── Espectrograma de Potencia (STFT)            └── Entropía espectral y envolvente de Shannon
```

* **Parámetros recomendados para Espectrograma Mel:**
  * `sr = 16000 Hz` (o `4000 Hz`).
  * `n_fft = 1024` muestras ($64\text{ ms}$).
  * `hop_length = 512` muestras ($32\text{ ms}$, 50% solapamiento).
  * `n_mels = 64` o `128` bandas de filtro mel.
  * Escala logarítmica: `librosa.power_to_db`.

---

## 5. Fase 4: Inteligencia Artificial y Clasificación Acústica

### 5.1 Tareas Clínicas de Clasificación Definidas

#### Tarea 1: Clasificación de Ruidos Respiratorios Anormales (ICBHI a nivel ciclo)
Problema de 4 clases mutuamente excluyentes por ciclo respiratorio:
1. **Normal:** Sin sibilancias ni crepitantes (`Crackles = 0, Wheezes = 0`).
2. **Solo Crepitantes (*Crackles*):** Ruidos secos y discontinuos típicos de neumonía o bronquiectasias (`Crackles = 1, Wheezes = 0`).
3. **Solo Sibilancias (*Wheezes*):** Silbidos continuos de tono alto típicos de obstrucción como asma o EPOC (`Crackles = 0, Wheezes = 1`).
4. **Ambos (*Both*):** Cuadro mixto (`Crackles = 1, Wheezes = 1`).

#### Tarea 2: Diagnóstico Patológico de Paciente (ICBHI a nivel paciente)
* **Binario:** Paciente Sano (*Healthy*) vs. Paciente Patológico (Cualquier enfermedad respiratoria).
* **Multiclase:** Sano vs. EPOC (COPD) vs. Neumonía vs. Infecciones (URTI/LRTI/Bronquiolitis).

#### Tarea 3: Detección de Cardiopatías en Fonocardiograma (PhysioNet 2016)
* **Binario:** Registro Normal (`-1`) vs. Registro Anormal (`1`, soplos, estenosis, arritmias valvulares).

---

### 5.2 Estrategia de Modelado Progresivo

Para garantizar rigor metodológico en la materia, implementar los modelos de forma progresiva:

```
[Nivel 1: Línea Base / Tabular]    --> Extracción de características estadísticas (MFCCs, energía) + Random Forest / SVM
[Nivel 2: Redes Convolucionales]   --> Espectrogramas Mel 2D + CNN Liviana (Custom 4-layer CNN o MobileNetV2 / ResNet-18)
[Nivel 3: Modelos Híbridos / SOTA] --> CRNN (CNN + LSTM) para temporalidad o Audio Spectrogram Transformer (AST)
[Nivel 4: Optimización Embebida]   --> Cuantización a INT8 mediante TensorFlow Lite (TinyML) para ESP32
```

### 5.3 Métricas de Evaluación Médica Obligatorias
Debido al severo desbalance de clases de las bases clínicas reales (por ejemplo, EPOC representa el 50.8% de pacientes en ICBHI mientras que asma es <1%), **nunca utilizar el Accuracy (Exactitud) de forma aislada**.

Métricas a calcular e informar siempre:
1. **Sensibilidad / Exhaustividad (*Sensitivity / Recall*):** Capacidad de detectar enfermos (evitar falsos negativos).
   $$\text{Sensibilidad (Se)} = \frac{TP}{TP + FN}$$
2. **Especificidad (*Specificity*):** Capacidad de identificar pacientes sanos (evitar falsos positivos).
   $$\text{Especificidad (Sp)} = \frac{TN}{TN + FP}$$
3. **ICBHI Score Oficial:** Media aritmética entre sensibilidad y especificidad:
   $$\text{Score}_{ICBHI} = \frac{\text{Se} + \text{Sp}}{2}$$
4. **F1-Score Macro y Matriz de Confusión Normalizada:** Para evaluar el desempeño equitativo en todas las clases.
5. **Curva ROC y AUC (Área Bajo la Curva ROC).**

---

## 6. Organización del Código de Datos e IA en el Repositorio

Para mantener un proyecto ordenado y profesional, el código de datos e inteligencia artificial debe organizarse bajo la siguiente estructura modular sugerida:

```
code/
├── data/                                 # Datasets crudos y organizados (en .gitignore los pesados)
│   ├── ICBHI_organizado.../
│   ├── training/
│   └── validation.../
├── notebooks/                            # Cuadernos de experimentación y visualización
│   ├── 01_exploracion_audio_eda.ipynb    # Visualización de formas de onda, espectrogramas y FFT
│   ├── 02_extraccion_caracteristicas.ipynb
│   └── 03_entrenamiento_clasificador.ipynb
├── src/                                  # Código fuente modular en Python
│   ├── __init__.py
│   ├── data_loader.py                    # Carga y parseo de anotaciones ICBHI y PhysioNet
│   ├── audio_processing.py               # Remuestreo, filtrado paso-banda, segmentación
│   ├── feature_extraction.py             # Generación de MFCCs, Mel-Spectrograms, Wavelets
│   └── evaluate.py                       # Cálculo de métricas clínicas (Se, Sp, ICBHI Score, ROC)
├── models/                               # Pesos de modelos entrenados (.pkl, .pth, .tflite)
└── requirements.txt                      # Dependencias de Python (librosa, torch/tensorflow, etc.)
```

---

## 7. Directrices para el Asistente de IA en los Próximos Chats

Cuando el usuario pida avanzar en datos o IA, el asistente debe seguir estas reglas:

1. **Priorizar scripts reproducibles:** Proveer código en Python documentado, modular y ejecutable, compatible con librerías estándar (`librosa`, `scipy`, `numpy`, `pandas`, `scikit-learn`, `matplotlib`, `torch` o `tensorflow`).
2. **Validar la estructura del dataset antes de correr:** Comprobar siempre que las rutas relativas apunten correctamente a `data/` respetando los nombres con espacios como `data/validation - pruebas realizadas` o `data/ICBHI_organizado - pacientes de los links filtrados`.
3. **Manejar el audio de forma vectorizada y eficiente:** Evitar cargar en RAM miles de archivos de audio simultáneamente sin generadores o `DataLoader` de PyTorch para prevenir desbordamientos de memoria.
4. **Mantener presente la relación con el hardware físico:** Recordar que los algoritmos de filtrado y extracción de características que se prueben en Python deben tener una lógica trasladable al procesamiento embebido en el ESP32 (muestreo a 16 kHz, cálculos de energía RMS o filtros digitales IIR/FIR).
