#!/usr/bin/env python3
"""
==============================================================================
PUENTE GATEWAY UNIVERSAL SPIROSCAN (BLUETOOTH SERIAL / USB -> BACKEND FASTAPI)
==============================================================================
Este script escucha las tramas JSON enviadas por el ESP32 (ya sea por el puerto
Bluetooth virtual de Windows o por cable USB) y las retransmite automáticamente
al servidor Backend FastAPI (http://localhost:8000/api/telemetry).
==============================================================================
"""

import sys
import time
import json

try:
    import requests
    http_session = requests.Session()
except ImportError:
    import urllib.request
    http_session = None

try:
    import serial
    import serial.tools.list_ports as list_ports
except ImportError:
    print("[!] Error: pyserial no está instalado. Ejecuta: pip install pyserial")
    sys.exit(1)

BACKEND_URL = "http://localhost:8000/api/telemetry"

def listar_puertos():
    puertos = list(list_ports.comports())
    return puertos

def seleccionar_puerto():
    if len(sys.argv) > 1:
        return sys.argv[1]

    puertos = listar_puertos()
    if not puertos:
        print("[!] No se detectaron puertos COM en el sistema.")
        return None

    print("\n" + "=" * 65)
    print("  PUERTOS COM DETECTADOS:")
    print("=" * 65)
    bt_ports = []
    usb_ports = []

    for idx, p in enumerate(puertos, 1):
        desc = p.description.lower()
        tipo = "Bluetooth" if "bluetooth" in desc or "vínculo" in desc else "USB/Serie"
        print(f"  [{idx}] {p.device} -> {p.description} ({tipo})")
        if tipo == "Bluetooth":
            bt_ports.append(p.device)
        else:
            usb_ports.append(p.device)

    print("=" * 65)
    
    # Si se especificó o hay opción clara
    opcion = input(f"\nSelecciona el número de puerto (1-{len(puertos)}) o escribe el nombre (ej. COM4): ").strip()
    if not opcion:
        if bt_ports:
            return bt_ports[0]
        return puertos[0].device
    
    if opcion.isdigit() and 1 <= int(opcion) <= len(puertos):
        return puertos[int(opcion) - 1].device
    
    return opcion.upper()

def reenviar_al_backend(datos_json):
    try:
        if http_session:
            resp = http_session.post(
                BACKEND_URL,
                data=datos_json.encode("utf-8"),
                headers={"Content-Type": "application/json"},
                timeout=0.8
            )
            return resp.status_code == 200
        else:
            req = urllib.request.Request(
                BACKEND_URL,
                data=datos_json.encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                return resp.status == 200
    except Exception:
        return False

def ejecutar_gateway(puerto_com, baudrate=115200):
    print(f"\n[*] Abriendo enlace en {puerto_com} a {baudrate} baudios...")
    print(f"[*] Destino Backend: {BACKEND_URL}")
    print("[*] Presiona CTRL + C para detener.\n")

    reintentos = 0
    while True:
        try:
            with serial.Serial(puerto_com, baudrate, timeout=0.1) as ser:
                print(f"[OK] ¡Conectado exitosamente al puerto {puerto_com}!")
                print("[*] Esperando telemetría del ESP32...\n")
                reintentos = 0

                while True:
                    linea = ser.readline().decode("latin1", errors="ignore").strip()
                    if not linea:
                        continue

                    # Solo procesar líneas con formato JSON válido de telemetría
                    if linea.startswith("{") and linea.endswith("}") and "bpm" in linea:
                        try:
                            packet = json.loads(linea)
                            bpm = packet.get("bpm", 0)
                            spo2 = packet.get("spo2", 0.0)
                            sys_bp = packet.get("systolic", 0)
                            dia_bp = packet.get("diastolic", 0)
                            temp = packet.get("temperature", 0.0)
                            dedo = "SI" if packet.get("finger", False) else "NO"

                            ok = reenviar_al_backend(linea)
                            estado_backend = "-> Backend OK" if ok else "-> Backend [Error/Offline]"

                            print(f"[SPIROSCAN] FC: {bpm:3d} BPM | SpO2: {spo2:4.1f}% | PA: {sys_bp:3d}/{dia_bp:2d} | Temp: {temp:4.1f}C | Dedo: {dedo:2s} | {estado_backend}")
                        except json.JSONDecodeError:
                            pass
                    elif "[*]" in linea or "[OK]" in linea or "[TELEMETRIA]" in linea:
                        print(f"  [ESP32]: {linea}")

        except serial.SerialException as e:
            reintentos += 1
            print(f"[!] Error de comunicación en {puerto_com}: {e}")
            print(f"[*] Reintentando reconexión en 3 segundos (intento {reintentos})...")
            time.sleep(3)
        except KeyboardInterrupt:
            print("\n[!] Gateway detenido por el usuario.")
            break

if __name__ == "__main__":
    puerto = seleccionar_puerto()
    if puerto:
        ejecutar_gateway(puerto)
