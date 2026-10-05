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
import os
import time
import json
import math
import re

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
    serial = None
    list_ports = None

BACKEND_URL = os.getenv("SPIROSCAN_TELEMETRY_URL", "http://localhost:8000/api/telemetry")

def listar_puertos():
    if list_ports is None:
        raise RuntimeError("Falta pyserial. Instala pyserial para leer el dispositivo físico.")
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

def normalizar_telemetria(packet):
    """Preserva procedencia y nunca convierte firmware legado en datos validados."""
    if not isinstance(packet, dict):
        raise ValueError("La telemetría debe ser un objeto JSON")
    packet = dict(packet)
    if packet.get('v') == 2:
        # El firmware compacto ya entrega calidad: conservar mascara, modos y temperatura del chip.
        mask = packet.get('valid')
        mask = mask if isinstance(mask, int) and not isinstance(mask, bool) and 0 <= mask <= 31 else 0
        simulated = packet.get('test') is True or packet.get('source') == 'simulated'
        active = not simulated and packet.get('power') != 'standby' and packet.get('finger') is not False
        def numeric(key):
            value = packet.get(key)
            return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        packet.update({
            'source': 'simulated' if simulated else packet.get('source', 'real'),
            'test': simulated,
            'heartRateValid': active and bool(mask & 1) and numeric('bpm') and packet['bpm'] > 0,
            'bloodOxygenValid': active and bool(mask & 2) and numeric('spo2') and 0 < packet['spo2'] <= 100,
            'spo2Calibrated': not simulated and packet.get('cal') is True,
            'sampleAgeMs': 0,
            'audioUnit': packet.get('audio_unit', 'relative_uncalibrated'),
            'valid': mask,
        })
        packet['signalQuality'] = 'good' if packet['heartRateValid'] else 'unstable'
        return packet
    source = packet.get("source", "unknown")
    if packet.get("test") is True:
        source = "simulated"
    if source not in {"real", "simulated", "unknown"}:
        source = "unknown"
    packet["source"] = source
    packet["test"] = source == "simulated"
    packet.setdefault("signalQuality", "unknown")
    packet["spo2Calibrated"] = source == "real" and packet.get("spo2Calibrated") is True
    age = packet.get("sampleAgeMs")
    fresh = isinstance(age, (int, float)) and not isinstance(age, bool) and math.isfinite(age) and 0 <= age <= 250
    acquired = source == "real" and fresh and packet.get("finger") is True and packet.get("signalQuality") == "good"
    for value_key, valid_key in (("bpm", "heartRateValid"), ("spo2", "bloodOxygenValid")):
        value = packet.get(value_key)
        numeric = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        packet[valid_key] = acquired and numeric and value > 0 and packet.get(valid_key) is True
        if value_key == "spo2":
            packet[valid_key] = packet[valid_key] and packet["spo2Calibrated"] and value <= 100
        # Values absent/nonfinite in old or corrupted packets are missing, not measurements.
        if not numeric:
            packet[value_key] = 0
            packet[valid_key] = False
    return packet

def formato_medida(packet, key, valid_key, unit):
    return f"{packet[key]:g} {unit}" if packet.get(valid_key) else "no disponible"

def reenviar_orden(payload, ser, last_command_id):
    """Forward each server order once; retries use a new server command ID."""
    command = payload.get("comando") if isinstance(payload, dict) else None
    if not isinstance(command, dict) or command.get("accion") != "grabar":
        return last_command_id
    command_id = command.get("id")
    if not isinstance(command_id, str) or not re.fullmatch(r"[0-9a-fA-F]{8}", command_id):
        return last_command_id
    command_id = command_id.lower()
    if command_id == last_command_id:
        return last_command_id
    message = f"REC_{command_id}\n".encode("ascii")
    if ser.write(message) != len(message):
        raise IOError("Serial recording command was not fully written")
    return command_id


def reenviar_al_backend(datos_json, on_response=None):
    try:
        if http_session:
            resp = http_session.post(
                BACKEND_URL,
                data=datos_json.encode("utf-8"),
                headers={"Content-Type": "application/json"},
                timeout=0.8
            )
            if resp.status_code != 200:
                return False
            if on_response:
                on_response(resp.json())
            return True
        else:
            req = urllib.request.Request(
                BACKEND_URL,
                data=datos_json.encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                if resp.status != 200:
                    return False
                if on_response:
                    on_response(json.loads(resp.read()))
                return True
    except Exception:
        return False

def ejecutar_gateway(puerto_com, baudrate=115200):
    if serial is None:
        raise RuntimeError("Falta pyserial. Instala pyserial para leer el dispositivo físico.")
    print(f"\n[*] Abriendo enlace en {puerto_com} a {baudrate} baudios...")
    print(f"[*] Destino Backend: {BACKEND_URL}")
    print("[*] Presiona CTRL + C para detener.\n")

    reintentos = 0
    while True:
        try:
            with serial.Serial(port=None, baudrate=baudrate, timeout=0.3) as ser:
                ser.port = puerto_com
                ser.dtr = False
                ser.rts = False
                ser.open()
                ser.reset_input_buffer()  # No reenviar muestras acumuladas antes de conectar.
                print(f"[OK] ¡Conectado exitosamente al puerto {puerto_com}!")
                print("[*] Esperando telemetría del ESP32...\n")
                reintentos = 0
                last_command_id = None

                def deliver_command(payload):
                    nonlocal last_command_id
                    last_command_id = reenviar_orden(payload, ser, last_command_id)

                while True:
                    linea = ser.readline().decode("latin1", errors="ignore").strip()
                    if not linea:
                        continue

                    # Solo procesar líneas con formato JSON válido de telemetría
                    if linea.startswith("{") and linea.endswith("}") and "bpm" in linea:
                        try:
                            packet = normalizar_telemetria(json.loads(linea))
                            bpm = formato_medida(packet, "bpm", "heartRateValid", "BPM")
                            spo2 = formato_medida(packet, "spo2", "bloodOxygenValid", "%")
                            dedo = "SI" if packet.get("finger", False) else "NO"

                            ok = reenviar_al_backend(json.dumps(packet, allow_nan=False), deliver_command)
                            estado_backend = "-> Backend OK" if ok else "-> Backend [Error/Offline]"

                            print(f"[SPIROSCAN] FC: {bpm} | SpO2: {spo2} | Origen: {packet['source']} | Dedo: {dedo} | {estado_backend}")
                            # El HTTP puede tardar: volver a esperar una trama nueva, no una cola vieja.
                            ser.reset_input_buffer()
                        except (ValueError, TypeError):
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
