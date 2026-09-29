@echo off
title SpiroScan AI - Enlace Bluetooth Movil y PC
echo =========================================================================
echo   FERIA TECNOLOGICA - SPIROSCAN AI (MODO BLUETOOTH AUTONOMO)
echo =========================================================================
echo.
echo Iniciando servidor seguro HTTPS para habilitar Bluetooth en Android...
echo.
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8081
pause
