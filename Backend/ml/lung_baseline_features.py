"""
Cálculo de las 61 características que usa el modelo base de pulmón (lung_baseline.py).

PENDIENTE: debe ser EXACTAMENTE el mismo cálculo que se usó al entrenar el modelo
(frecuencia de muestreo, filtrado, tamaño de ventana y salto, número de MFCC, cómo se promedia).
Si se reconstruye "a ojo", el modelo recibe números distintos a los de su entrenamiento y sus
resultados dejan de ser confiables. Cuando el autor comparta su código:
  1. Implementar extract(y, sr) para que devuelva un dict {nombre: valor} con los 61 nombres
     de modelo_icbhi_exportado.json["feature_names"].
  2. Cambiar READY a True.
"""

READY = False


def extract(y, sr: int) -> dict:
    raise NotImplementedError("Extractor de las 61 características pendiente del código de entrenamiento.")
