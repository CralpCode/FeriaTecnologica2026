import serial
import time
import subprocess
import sys

print("=========================================================================")
print("  ASISTENTE DE CARGA DIRECTA ESP32")
print("=========================================================================")
print("1. Abre el puerto COM5...")

s = serial.Serial('COM5', 115200, timeout=0.1)

print("\n-------------------------------------------------------------------------")
print("  ATENCION: COLOCA TU DEDO SOBRE EL BOTON 'BOOT' Y MANTENLO PRESIONADO")
print("  NO LO SUELTES...")
print("-------------------------------------------------------------------------")

for i in range(3, 0, -1):
    print(f"Enviando pulso de reinicio en {i} segundos...")
    time.sleep(1)

print("\n>>> ENVIANDO PULSO DE RESET MIENTRAS MANTIENES BOOT... <<<")

# Reset pulse:
s.dtr = False
s.rts = True   # EN = 0 (Reset)
time.sleep(0.15)
s.rts = False  # EN = 1 (Release reset while user holds BOOT)
time.sleep(0.2)

# Read response:
t0 = time.time()
raw_bytes = b""
while time.time() - t0 < 1.5:
    chunk = s.read(100)
    if chunk:
        raw_bytes += chunk

s.close()

text = raw_bytes.decode('latin1', errors='replace')
print("\n--- RESPUESTA DEL ESP32 ---")
for line in text.strip().split('\n')[:8]:
    print(" ", line.strip())
print("---------------------------\n")

if "boot:0x3" in text or "waiting for download" in text:
    print(">>> ¡¡MODO DOWNLOAD_BOOT DETECTADO EXITOSAMENTE!! <<<")
    print(">>> Iniciando grabacion del firmware con esptool...")
    cmd = [
        r"C:\Users\calin\AppData\Local\Arduino15\packages\esp32\tools\esptool_py\5.3.1\esptool.exe",
        "--chip", "esp32",
        "--port", "COM5",
        "--baud", "921600",
        "--before", "no-reset",
        "--after", "hard-reset",
        "write-flash", "-z",
        "--flash_mode", "dio",
        "--flash_freq", "80m",
        "--flash_size", "4MB",
        "0x1000", r"C:\Users\calin\AppData\Local\Arduino15\packages\esp32\hardware\esp32\3.1.3\tools\sdk\esp32\bin\bootloader_qio_80m.bin",
        "0x8000", r"Esp32.ino.partitions.bin",
        "0xe000", r"C:\Users\calin\AppData\Local\Arduino15\packages\esp32\hardware\esp32\3.1.3\tools\partitions\boot_app0.bin",
        "0x10000", r"Esp32.ino.bin"
    ]
    # Check if files exist
    print("Ejecutando upload...")
elif "boot:0x13" in text or "FERIA TECNOLOGICA" in text:
    print(">>> RESULTADO: El ESP32 arranco en modo NORMAL (boot:0x13).")
    print(">>> Esto significa que el boton presionado no aterrizo GPIO 0.")
else:
    print(">>> No se recibio texto de arranque claro.")
