@echo off
title SpiroScan AI - Compilador ESP32
echo =========================================================================
echo   Compilando Firmware Real ESP32 (SpiroScan AI)...
echo =========================================================================
cd /d "%~dp0"
"..\Emulador\arduino-cli.exe" compile --fqbn esp32:esp32:esp32:PartitionScheme=huge_app Esp32.ino
if %ERRORLEVEL% equ 0 (
    echo.
    echo =========================================================================
    echo   [OK] Compilacion exitosa.
    echo   Para subir a tu ESP32, conecta el USB y escribe el puerto COM (ej. COM3):
    echo =========================================================================
    set /p COMPORT="Puerto COM: "
    if not "%COMPORT%"=="" (
        "..\Emulador\arduino-cli.exe" upload -p %COMPORT% --fqbn esp32:esp32:esp32:PartitionScheme=huge_app Esp32.ino
    )
) else (
    echo.
    echo [ERROR] Ocurrio un problema durante la compilacion.
)
pause
