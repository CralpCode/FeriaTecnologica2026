import serial
import time
import subprocess
import sys

PORT = "COM5"
BAUD = 115200
ESPTOOL = r"C:\Users\calin\AppData\Local\Arduino15\packages\esp32\tools\esptool_py\5.3.1\esptool.exe"

print("=========================================================================")
print("  DETECTOR EN VIVO DE MODO BOOTLOADER (ESP32)")
print("=========================================================================")
print(f"Abriendo {PORT}...")

try:
    s = serial.Serial(PORT, BAUD, timeout=0.1)
except Exception as e:
    print(f"Error abriendo {PORT}: {e}")
    sys.exit(1)

print("\n>>> ESCUCHANDO EL ESP32 EN TIEMPO REAL <<<")
print("Por favor, haz la prueba con los botones en tu placa:")
print("1. Mantén presionado el botón que dice BOOT.")
print("2. Presiona y suelta el botón que dice EN (o RST).")
print("-------------------------------------------------------------------------")

start = time.time()
detected = False
buffer = ""

while time.time() - start < 10:
    chunk = s.read(100)
    if chunk:
        text = chunk.decode("latin1", errors="replace")
        buffer += text
        if "waiting for download" in buffer or "boot:0x3" in buffer or "boot:0x1" in buffer:
            print("\n" + "="*60)
            print("  ¡¡EXITO!! SE HA DETECTADO EL REINICIO / BOOTLOADER")
            print("="*60)
            detected = True
            break
        elif "FERIA TECNOLOGICA" in text or "SPIROSCAN" in text or "VITALSYNC" in text:
            print("[INFO] El ESP32 se acaba de reiniciar en modo NORMAL (no en Bootloader).")
            buffer = ""

s.close()

if not detected:
    print("\n[TIEMPO AGOTADO] No se detectó ningún reinicio del chip en estos 10 segundos.")
    print("Esto significa que el botón EN/RST no está reseteando el microcontrolador o no se presionó.")
