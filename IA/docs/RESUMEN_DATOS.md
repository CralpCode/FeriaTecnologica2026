# RESUMEN, CONTEO Y MAPEO DE LOS DATOS BIOMÉDICOS
> **Directorio base:** `data/`  
> **Última actualización:** Septiembre 2026

Este documento detalla el inventario cuantitativo, la organización jerárquica y el mapeo técnico de todas las bases de datos acústicas y clínicas almacenadas en la carpeta `data/`.

---

## 1. Inventario General de Datos

```
data/
├── ICBHI_2017_pacientes_filtrable_1.xlsx               # Archivo maestro de pacientes y metadatos clínicos (126 pacientes)
├── ICBHI_organizado - pacientes de los links filtrados/ # 16 categorías cruzadas [Edad]__[Patología] (126 carpetas de paciente)
├── training/                                           # PhysioNet 2016 Training: 3,240 audios PCG (subsets a-f)
└── validation - pruebas realizadas/                    # PhysioNet 2016 Validation: 301 audios PCG independientes
```

---

## 2. Dataset 1: PhysioNet / CinC Challenge 2016 (Sonidos Cardíacos - PCG)

* **Propósito:** Clasificación de grabaciones de fonocardiograma (PCG) en **Normales** vs. **Anormales**.
* **Fuente:** PhysioNet / Computing in Cardiology Challenge 2016 (`https://archive.physionet.org/pn3/challenge/2016/`).
* **Volumen Total:** **3,541 archivos de audio `.wav`** (3,240 entrenamiento + 301 validación).

### 2.1 Desglose del Conjunto de Entrenamiento (`data/training/`)

Cada subconjunto proviene de diferentes fuentes clínicas y dispositivos de grabación internacionales:

| Subdirectorio | Archivos `.wav` | Archivos `.hea` (Cabeceras) | Archivos `.dat` (Señales) | Etiquetas de Referencia | Procedencia / Entorno de Adquisición |
| :--- | :---: | :---: | :---: | :--- | :--- |
| `training-a` | 409 | 409 | 405 (ECG sincrónico) | `REFERENCE.csv` | MIT / Niños y adultos (hospitalario) |
| `training-b` | 490 | 490 | 0 | `REFERENCE.csv` | DMinh / Pacientes ambulatorios |
| `training-c` | 31 | 31 | 0 | `REFERENCE.csv` | Pacientes pediátricos con cardiopatías congénitas |
| `training-d` | 55 | 55 | 0 | `REFERENCE.csv` | Grabaciones de alta fidelidad clínica |
| `training-e` | 2,141 | 2,141 | 0 | `REFERENCE.csv` | Base de datos masiva multicéntrica de sonidos cardíacos |
| `training-f` | 114 | 114 | 0 | `REFERENCE.csv` | Sujetos en ambientes no clínicos / controlados |
| **Total Training** | **3,240** | **3,240** | **405** | — | — |

### 2.2 Desglose del Conjunto de Validación (`data/validation - pruebas realizadas/`)
* **Archivos `.wav`:** 301 grabaciones independientes.
* **Archivos de control:** `REFERENCE.csv`, `MD5SUMS`, `SHA1SUMS`, `SHA256SUMS`.
* **Codificación de Etiquetas en `REFERENCE.csv`:**
  * `1` = **Anormal** (Presencia de soplos, alteraciones de tono cardíaco, anomalías valvulares).
  * `-1` = **Normal** (Tonos fundamentales $S_1$ y $S_2$ limpios, sin soplos patológicos).

---

## 3. Dataset 2: ICBHI 2017 Challenge (Sonidos Respiratorios)

* **Propósito:** Detección de ruidos adventicios (sibilancias y estertores) y clasificación diagnóstica de patologías respiratorias.
* **Fuente:** International Conference on Biomedical and Health Informatics 2017 (`https://bhichallenge.med.auth.gr/node/51` y Kaggle).
* **Población:** **126 pacientes** diagnosticados con edades desde 0 meses (bebés) hasta 93 años (adultos mayores).

### 3.1 Archivo Maestro: `data/ICBHI_2017_pacientes_filtrable_1.xlsx`

Contiene la consolidación demográfica y clínica en 3 hojas de cálculo:

1. **Hoja `Datos ICBHI 2017`:**
   * Lista exhaustiva de los 126 pacientes con las siguientes columnas:
     * `ID Paciente`: Identificador numérico único (e.g., 101, 111, 226).
     * `Edad (anos)`: Edad decimal del paciente.
     * `Grupo de edad`: Bebe (<1 año), Niño/Adolescente (1-17), Adulto (18-64), Adulto mayor (65+), Desconocido.
     * `Sexo`: M (Masculino), F (Femenino).
     * `Diagnostico`: Condición respiratoria diagnosticada.
     * `BMI adulto (kg/m2)`: Índice de masa corporal para adultos.
     * `Peso nino (kg)` y `Altura nino (cm)`: Datos antropométricos pediátricos.
2. **Hoja `Prueba 1 - Mayores COPD`:**
   * Filtro de consulta modelo: `Edad >= 65 años AND Diagnostico = COPD`.
   * Identifica **47 pacientes** que cumplen este criterio crítico de alto riesgo.
3. **Hoja `Resumen`:**
   * Estadísticas de distribución diagnóstica y etaria del dataset.

#### Distribución Diagnóstica en ICBHI (126 Pacientes)

| Diagnóstico Clínico | Pacientes | Porcentaje | Descripción / Impacto Clínico |
| :--- | :---: | :---: | :--- |
| **COPD (EPOC)** | 64 | 50.8% | Enfermedad Pulmonar Obstructiva Crónica (mayoritaria en adultos y ancianos) |
| **Healthy (Sanos)** | 26 | 20.6% | Grupo de control sin patología respiratoria |
| **URTI** | 14 | 11.1% | Infección de vías respiratorias superiores (*Upper Respiratory Tract Infection*) |
| **Bronchiectasis** | 7 | 5.6% | Dilatación irreversible de los bronquios |
| **Pneumonia** | 6 | 4.8% | Infección alveolar aguda bacteriana o viral |
| **Bronchiolitis** | 6 | 4.8% | Inflamación de vías pequeñas, típica en bebés y niños |
| **LRTI** | 2 | 1.6% | Infección de vías respiratorias inferiores (*Lower Respiratory Tract Infection*) |
| **Asthma (Asma)** | 1 | 0.8% | Afección inflamatoria crónica con hiperreactividad bronquial |
| **Total** | **126** | **100%** | — |

---

### 3.2 Estructura de Directorios: `data/ICBHI_organizado - pacientes de los links filtrados/`

Los 126 pacientes fueron particionados en **16 categorías exclusivas** que combinan el grupo etario con su patología:

```
ICBHI_organizado - pacientes de los links filtrados/
├── Adulto_18-64__Bronchiectasis/         (6 pacientes: 111, 116, 168, 169, 196, 215)
├── Adulto_18-64__COPD/                   (16 pacientes: 112, 113, 134, 138, 139, 157, 158, 163, 175, 177, 178, 203, 205, 207, 213, 222)
├── Adulto_mayor_65mas__Asthma/           (1 paciente: 103)
├── Adulto_mayor_65mas__Bronchiectasis/   (1 paciente: 201)
├── Adulto_mayor_65mas__COPD/             (47 pacientes: 104, 106, 107, 109, 110, 114, 117, 118, 120, 124, 128, 130, 132, 133, 141, ...)
├── Adulto_mayor_65mas__Pneumonia/        (5 pacientes: 122, 135, 140, 191, 217)
├── Bebe_menos_1_ano__Bronchiolitis/      (1 paciente: 149)
├── Bebe_menos_1_ano__Healthy/            (5 pacientes: 102, 143, 159, 187, 219)
├── Bebe_menos_1_ano__LRTI/               (1 paciente: 115)
├── Bebe_menos_1_ano__URTI/               (1 paciente: 150)
├── Desconocido__COPD/                    (1 paciente: 223)
├── Nino_Adolescente_1-17__Bronchiolitis/ (5 pacientes: 161, 167, 173, 206, 216)
├── Nino_Adolescente_1-17__Healthy/       (21 pacientes: 121, 123, 125, 126, 127, 136, 144, 152, 153, 171, 179, 182, 183, 184, ...)
├── Nino_Adolescente_1-17__LRTI/          (1 paciente: 170)
├── Nino_Adolescente_1-17__Pneumonia/     (1 paciente: 197)
└── Nino_Adolescente_1-17__URTI/          (13 pacientes: 101, 105, 119, 129, 148, 164, 172, 181, 188, 190, 204, 210, 211)
```

#### Contenido interno de cada carpeta de paciente:
Dentro de cada carpeta de paciente (ej. `paciente_111/`):
* **`datos_paciente_<id>.csv`**: Ficha individual con ID, edad, sexo, diagnóstico, IMC, antropometría infantil y partición sugerida (Entrenamiento / Validación).
* **`audios/`**: Subdirectorio destino para las grabaciones acústicas `.wav` y anotaciones `.txt`.
  * *Estado actual:* **Totalmente poblado y verificado.** Contiene las grabaciones de auscultación en formato `.wav` y sus correspondientes archivos de anotación de ciclos respiratorios en formato `.txt` (920 pares en total distribuidos entre los 126 pacientes). Los marcadores temporales `LEEME.txt` fueron eliminados tras la ejecución exitosa de `organizar_por_categoria.py`.

---

## 4. Mapeo entre Sensores Físicos del Prototipo y Datasets

| Sensor Físico | Señal Adquirida en Prototipo | Dataset Clínico de Mapeo | Variable / Patología a Evaluar |
| :--- | :--- | :--- | :--- |
| **MAX30102** | Señal Fotopletismográfica (PPG) Roja e Infrarroja | Registros de $SpO_2$ y FC de pacientes clínicos | Cálculo de $\%SpO_2$ y detección de desaturación en pacientes EPOC/Neumonía |
| **INMP441** | Audio digital I2S de auscultación torácica y tos | **ICBHI 2017 Challenge** (`.wav`) | Detección de sibilancias (*wheezes*), crepitantes (*crackles*), duración y frecuencia de accesos de tos |
| **INMP441** | Audio digital I2S en posición precordial (pecho) | **PhysioNet Challenge 2016** (`.wav`) | Identificación de latidos $S_1 / S_2$ y discriminación de ruidos normales vs. anormales (soplos) |
