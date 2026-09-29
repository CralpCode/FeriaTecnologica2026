import serial, subprocess, time, sys

print('==================================================================')
print('  ASISTENTE DE FLASHEO INTELIGENTE (SIN ERRORES DE TIEMPO)')
print('==================================================================')
print('Presiona con la punta de un lapiz/pluma el boton BOOT y dale un clic a EN.')
print('Esperando que la placa entre en modo DOWNLOAD_BOOT (boot:0x3)...')
print('------------------------------------------------------------------')

s = serial.Serial('COM5', 115200, timeout=0.1)
boot_mode_detected = False
t0 = time.time()

while time.time() - t0 < 30:
    line = s.readline().decode('utf-8', errors='replace').strip()
    if line:
        if 'boot:0x' in line:
            print('ESTADO DETECTADO:', line)
            if 'boot:0x3' in line or 'download' in line.lower():
                print('>>> MODO DESCARGA DETECTADO EXITOSAMENTE! <<<')
                boot_mode_detected = True
                break
s.close()

if boot_mode_detected:
    print('[*] Lanzando grabacion de firmware con --before no-reset...')
    cmd = [
        r'C:\Users\calin\AppData\Local\Arduino15\packages\esp32\tools\esptool_py\5.3.1\esptool.exe',
        '--chip', 'esp32', '--port', 'COM5', '--baud', '460800', '--before', 'no-reset',
        'write-flash',
        '0x1000', r'c:\Users\calin\OneDrive\Documents\PlatformIO\Projects\feria tec\.pio\build\esp32doit-devkit-v1\bootloader.bin',
        '0x8000', r'c:\Users\calin\OneDrive\Documents\PlatformIO\Projects\feria tec\.pio\build\esp32doit-devkit-v1\partitions.bin',
        '0x10000', r'c:\Users\calin\OneDrive\Documents\PlatformIO\Projects\feria tec\.pio\build\esp32doit-devkit-v1\firmware.bin'
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    print(res.stdout)
    if res.returncode == 0:
        print('\n=============================================================')
        print('  >>> FELICIDADES! FIRMWARE FLASHEADO CON EXITO AL 100% <<<')
        print('=============================================================')
    else:
        print(res.stderr)
else:
    print('Tiempo de espera agotado (30 segundos).')
