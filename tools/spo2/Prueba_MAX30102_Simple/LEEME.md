# Prueba sencilla MAX30102

Abre `Prueba_MAX30102_Simple.ino` en Arduino IDE. Solo requiere el paquete de
placas ESP32 de Espressif; no necesitas instalar bibliotecas MAX3010x ni copiar
archivos auxiliares.

1. Selecciona tu ESP32 y su puerto USB.
2. Pulsa **Subir** (la flecha). Verificar solo compila.
3. Abre el Monitor serial a **115200 baudios** y pulsa EN/RESET.
4. Debe aparecer `PRUEBA SIMPLE MAX30102` y luego `LISTO`.
5. Mira los valores durante unos segundos sin dedo y después con el dedo quieto.
   La captura es continua; no hay comandos START/STOP. Retirar el dedo no la detiene.

Conserva el cableado actual: SDA=GPIO21, SCL=GPIO22, GND común y alimentación
actual del módulo. La prueba mantiene I2C a 100 kHz y los ajustes ópticos anteriores.

Salida: `ROJO:12345 IR:67890`. Son cuentas del ADC, no SpO2 ni BPM.
Cambios al poner el dedo muestran respuesta óptica; por sí solos no validan
mediciones de oxígeno ni demuestran que todo el módulo esté sano.
La consola muestra errores I2C y descarta lecturas incompletas en vez de
convertirlas en valores válidos. Imprime hasta diez pares por segundo;
no guarda todas las muestras para análisis de pulso.

Si aparecen caracteres ilegibles, comprueba los baudios del **Monitor serial**,
que son una opción distinta de Upload Speed, y confirma que la carga terminó.

Configuración y lectura FIFO según la ficha técnica MAX30102:
https://www.analog.com/media/en/technical-documentation/data-sheets/max30102.pdf

Esta prueba reemplaza temporalmente la aplicación del ESP32 al subirla;
para volver al proyecto debes cargar su firmware habitual.
