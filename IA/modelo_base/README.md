# Modelo base de pulmón (regresión logística, 61 características)

Código original del compañero del equipo (repositorio `spiroscan-analysis`, commit `f731494`, 3 de octubre de 2026),
traído aquí para que el proyecto tenga el cálculo exacto de las 61 características y su verificación.

| Archivo | Qué es |
|---|---|
| `src/audio_processing.py` | Carga a 16 kHz, filtro paso banda 100–2000 Hz y recorte de cada ciclo a 4 s |
| `src/feature_extraction.py` | Las 61 características (RMS, ZCR, centroide, roll-off, MFCC 1–13 con deltas) |
| `src/extract_all_features.py`, `src/train.py`, `src/compare_models.py`, `src/data_loader.py` | Extracción masiva, entrenamiento y comparación de modelos (esperan la estructura de carpetas original del autor) |
| `features_icbhi_dataset.csv` | Características de los 6,898 ciclos de ICBHI calculadas por el autor |
| `notebooks/` | Exploración de datos y figuras (`IA/docs/figuras_eda/`) |
| `verificar_modelo_base.py` | Verificación reproducible con la estructura de este repositorio |

El modelo entrenado ya está en `Backend/models/mejor_clasificador_icbhi.joblib` (es el mismo archivo).

## Verificación (`python modelo_base/verificar_modelo_base.py`, resultados en `resultados_verificacion.json`)

- **Extractor:** en 60 ciclos al azar, el código reproduce las 61 características del CSV (error relativo mediano 0 %, máximo 0.33 %).
- **Modelo:** partición por paciente del CSV (102 pacientes de entrenamiento, 24 de validación, ninguno compartido).
  En validación: AUC 0.71. Con el umbral del servidor (0.30): sensibilidad 90 %, especificidad 31 %.
  Con 0.50: sensibilidad 68 %, especificidad 64 %.

## Por qué no se usa con grabaciones del dispositivo

- Con el umbral 0.30, marca como anormales a cerca de 7 de cada 10 ciclos normales.
- Se entrenó con ciclos respiratorios recortados de ICBHI (estetoscopios clínicos). El servidor recibe grabaciones
  completas del dispositivo, sin ciclos marcados, y su respuesta acústica aún no se ha medido con el fantoma.

Por eso el servidor lo usa solo en los casos de demostración ICBHI (que traen las características calculadas por el
autor) y no en grabaciones reales; las redes de pulmón son las que analizan las grabaciones.
