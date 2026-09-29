# Script de compilación automática para Wokwi ESP32
Write-Host "Compilando Emulador.ino para ESP32..." -ForegroundColor Cyan
.\arduino-cli.exe compile --fqbn esp32:esp32:esp32:PartitionScheme=huge_app --output-dir .

if ($LASTEXITCODE -eq 0) {
    Copy-Item "Emulador.ino.bin" "sketch.bin" -Force
    Copy-Item "Emulador.ino.elf" "sketch.elf" -Force
    Write-Host "Compilación exitosa. sketch.bin y sketch.elf actualizados para Wokwi." -ForegroundColor Green
} else {
    Write-Host "Error en la compilación." -ForegroundColor Red
}
