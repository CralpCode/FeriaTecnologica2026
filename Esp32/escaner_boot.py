import subprocess
import time

ESPTOOL = r"C:\Users\calin\AppData\Local\Arduino15\packages\esp32\tools\esptool_py\5.3.1\esptool.exe"
BIN = r"build\esp32.esp32.esp32\Esp32.ino.merged.bin"

print("=========================================================================")
print("  ESCANER CONTINUO DE MODO BOOTLOADER (DETECTA CUANDO ENTRE)")
print("=========================================================================")
print("El escaner estara activo durante 25 segundos.")
print("Prueba la combinacion de los DOS BOTONES mientras esto corre...")

t0 = time.time()
success = False

while time.time() - t0 < 25:
    cmd = [
        ESPTOOL,
        "--chip", "esp32",
        "--port", "COM5",
        "--baud", "115200",
        "--before", "no-reset-no-sync",
        "--connect-attempts", "1",
        "chip-id"
    ]
    # We can also try with --before no-reset
    res = subprocess.run([ESPTOOL, "--chip", "esp32", "--port", "COM5", "--baud", "115200", "--before", "no-reset", "--connect-attempts", "1", "chip-id"], capture_output=True, text=True)
    if "Chip is ESP32" in res.stdout or "Features:" in res.stdout:
        print("\n" + "#"*60)
        print("  ¡¡CHIP DETECTADO EN MODO BOOTLOADER!! GRABANDO AHORA...")
        print("#"*60)
        # Flash immediately!
        flash_cmd = [
            ESPTOOL,
            "--chip", "esp32",
            "--port", "COM5",
            "--baud", "460800",
            "--before", "no-reset",
            "--after", "hard-reset",
            "write-flash", "0x0", BIN
        ]
        flash_res = subprocess.run(flash_cmd, capture_output=True, text=True)
        print(flash_res.stdout)
        if flash_res.returncode == 0:
            print("\n>>> ¡¡GRABACION EXITOSA AL 100%!! <<<")
            success = True
            break
        else:
            print("Error en grabacion:", flash_res.stderr)
            break
    else:
        print(".", end="", flush=True)
        time.sleep(0.5)

if not success:
    print("\n[FIN] No se detecto el chip en modo bootloader.")
