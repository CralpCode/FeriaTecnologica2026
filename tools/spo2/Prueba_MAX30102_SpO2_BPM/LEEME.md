# Prueba SpO₂ y BPM en un solo archivo

Abre `Prueba_MAX30102_SpO2_BPM.ino` en Arduino IDE. Solo necesita el paquete de
placas ESP32 de Espressif. No necesita instalar una biblioteca de sensores.

1. Selecciona tu ESP32 y su puerto. Pulsa **Subir**.
2. Abre el Monitor serial a **115200 baudios**, con **Nueva línea**, y pulsa EN/RESET.
3. Comprueba que aparece `PRUEBA SpO2 + BPM CALIDAD 2026-10-05`.
4. Envía `RAW` una vez para incluir la señal óptica en la captura.
5. Mantén el dedo colocado y quieto durante 30 segundos completos. Anota al mismo
   tiempo el oxígeno y el pulso del oxímetro de referencia.

Funciona continuamente, sin START/STOP. La primera ventana tarda unos cuatro
segundos; después se actualiza cada segundo. Enviar `RAW` otra vez oculta las
líneas de señal bruta.

## Interpretar la consola

- `SpO2_estimada` y `BPM_estimado`: estimaciones experimentales que superaron
  los controles descritos abajo. **No son mediciones con calibración validada**.
- `--`: la señal no supera los controles o todavía espera estabilidad. No significa
  cero de oxígeno ni conserva un valor anterior como lectura nueva.
- `motivo`: razón para aceptar o descartar la ventana. Algunos motivos del
  procesador están en inglés, como `weak_signal` (señal débil).
- `candidato_SpO2` y `candidato_BPM`: resultados originales del cálculo, incluidos
  los descartados. No deben interpretarse como mediciones fiables.
- `alg_SpO2` y `alg_BPM`: 1 significa que el algoritmo produjo un candidato;
  **no demuestra calidad de señal ni exactitud**. `-999` significa sin cálculo.
- `R_ref`: cociente rojo/IR usado por la tabla del algoritmo de referencia.
- `R_ciclos`: cociente calculado sobre ciclos comunes de ambos canales. Es un
  diagnóstico; no se convierte a porcentaje con la tabla del otro estimador.
- `ciclos` y `BPM_ciclos`: ciclos aceptados y pulso diagnóstico de esos ciclos.
- `I2C_errores`: contador acumulado de transferencias fallidas o incompletas.
- `RAW25,secuencia,rojo,IR`: pares ópticos a 25 Hz antes del análisis. Permiten
  revisar ondas, cambios de contacto y discontinuidades en otra herramienta.

Retirar y recolocar el dedo puede contaminar una ventana de cuatro segundos.
La captura que mezcla esos momentos no permite atribuir los saltos al módulo.
Los controles tampoco garantizan detectar todo movimiento o toda pérdida de contacto.

## Controles de calidad

Se analizan exactamente 100 pares a 25 Hz. El procesador exige al menos tres
ciclos completos, correlación rojo/IR mínima de 0,85, variación de intervalos
de hasta 20 % y dispersión relativa MAD del cociente de hasta 15 %. Rechaza
ceros, saturación, señal débil y ciclos incompatibles.

Además, se exige que los dos estimadores del cociente y del pulso concuerden
dentro del 20 %. Para mostrar SpO₂, el candidato debe estar entre 70 y 100 y
tres ventanas sucesivas deben variar como máximo dos puntos porcentuales.
Estas ventanas comparten el 75 % de sus muestras: **no son tres mediciones
independientes**. No se promedian ni se fuerzan valores hacia 95 o 97.

Son límites de ingeniería para esta prueba, pendientes de validar con capturas
reales. El intervalo 70–100 es un filtro de presentación de esta prueba, no
un criterio médico ni una demostración de que los valores dentro de él sean correctos.
Errores I²C, saturación y desbordamiento descartan la ventana y reinician la espera
de estabilidad. La calidad no reemplaza la calibración óptica del módulo.

## Hardware y código

Se conservan los ajustes de la prueba anterior: SDA=21, SCL=22, I²C=100 kHz;
LED rojo/IR=0x35, promedio hardware=4, ADC=4096, muestreo=400 Hz y ancho=411 µs.
Los 100 pares/s del FIFO se promedian de cuatro en cuatro para obtener 25 Hz.

Se integra MAXREFDES117 distribuido por SparkFun, con sus licencias y las
correcciones aritméticas de 64 bits existentes en el proyecto. Esta copia
independiente corrige también la selección de mediana y una lectura fuera
de los límites al buscar el extremo de una meseta. El análisis de calidad
procede del procesador ya incluido en `Prueba_MAX30102/spo2_signal.cpp`.

Fuente del algoritmo:
https://github.com/sparkfun/SparkFun_MAX3010x_Sensor_Library/blob/master/src/spo2_algorithm.cpp

El detector de latidos y las configuraciones del firmware principal no se
modifican. Subir esta prueba reemplaza temporalmente la aplicación del ESP32;
para regresar, carga el firmware habitual del proyecto.

Compilar comprueba que el programa se construye; no valida el oxígeno real.
