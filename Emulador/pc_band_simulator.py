#!/usr/bin/env python3
"""
==============================================================================
ESTACIÓN DE EMULACIÓN DE HARDWARE BIOMÉDICO - SPIROSCAN BAND (PC EMULATOR)
==============================================================================
1. Abre un servidor de enlace directo en el puerto 8765 para tu teléfono.
2. Espera a que tu teléfono se conecte.
3. Transmite valores SINTÉTICOS de demostración; no mide ni diagnostica.
==============================================================================
"""

import os
import sys
import time
import math
import random
import threading
import json
import asyncio

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

try:
    import websockets
except ImportError:
    os.system("pip install websockets")
    import websockets

try:
    import requests
except ImportError:
    os.system("pip install requests")
    import requests

PORT = 8765
DEVICE_ID = "SpiroScan-PC-SIMULADOR"

class VitalsState:
    def __init__(self):
        self.running = True
        self.scenario = "rest"
        self.connected_phones = set()
        self.packets_sent = 0
        
        self.bpm = 74
        self.spo2 = 98.4
        self.systolic = 118
        self.diastolic = 76
        self.stress = 28
        self.audio_rms = 18.5
        self.audio_peak = 28.0
        
        self.scenarios = {
            "rest": {"name": "1. Reposo Normal", "bpm": 74, "spo2": 98.5, "sys": 118, "dia": 76, "db": 18.0},
            "active": {"name": "2. Ejercicio / Taquicardia", "bpm": 125, "spo2": 97.2, "sys": 136, "dia": 86, "db": 36.0},
            "hypertension": {"name": "3. Hipertension / Estres", "bpm": 102, "spo2": 96.0, "sys": 158, "dia": 98, "db": 42.0},
            "hypoxia": {"name": "4. Hipoxia / Desaturacion", "bpm": 90, "spo2": 89.5, "sys": 112, "dia": 72, "db": 16.0},
            "relax": {"name": "5. Relajacion / Sueno", "bpm": 60, "spo2": 99.4, "sys": 106, "dia": 68, "db": 12.0},
        }

state = VitalsState()

def physiological_engine_loop():
    while state.running:
        now = time.time()
        base = state.scenarios[state.scenario]
        
        sinus = 6.0 * math.sin(now * 2.0 * math.pi * 0.25)
        mayer = 4.0 * math.cos(now * 2.0 * math.pi * 0.10)
        jitter = random.uniform(-1.5, 1.5)
        
        state.bpm = int(base["bpm"] + sinus + mayer + jitter)
        state.bpm = max(45, min(190, state.bpm))
        
        spo2_drift = 0.6 * math.sin(now * 0.8) + random.uniform(-0.15, 0.15)
        state.spo2 = round(max(85.0, min(99.8, base["spo2"] + spo2_drift)), 1)
        
        sys_offset = int((state.bpm - base["bpm"]) * 0.45 + 3.0 * math.sin(now * 0.5) + random.uniform(-2, 2))
        dia_offset = int((state.bpm - base["bpm"]) * 0.22 + 2.0 * math.cos(now * 0.4) + random.uniform(-1, 1))
        
        state.systolic = max(85, min(210, base["sys"] + sys_offset))
        state.diastolic = max(50, min(130, base["dia"] + dia_offset))
        
        ambient_noise = base["db"] + 4.0 * math.sin(now * 1.2) + random.uniform(-2.0, 2.0)
        state.audio_rms = round(max(8.0, ambient_noise), 2)
        state.audio_peak = round(state.audio_rms * random.uniform(1.2, 1.45), 2)
        
        state.stress = int(max(5, min(98, (state.bpm - 48) * 1.25 + (state.audio_rms * 0.4))))
        time.sleep(0.08)

async def ws_server_loop():
    async def handler(websocket):
        state.connected_phones.add(websocket)
        client_ip = websocket.remote_address[0]
        
        await websocket.send(json.dumps({
            "type": "DEVICE_HANDSHAKE",
            "source": "simulated",
            "test": True,
            "device": DEVICE_ID,
            "mac": "SIMULATED"
        }))
        
        try:
            async for message in websocket:
                pass
        except Exception:
            pass
        finally:
            state.connected_phones.remove(websocket)

    async def broadcast_loop():
        while state.running:
            if state.connected_phones:
                packet = json.dumps({
                    "source": "simulated",
                    "test": True,
                    "heartRateValid": False,
                    "bloodOxygenValid": False,
                    "spo2Calibrated": False,
                    "signalQuality": "simulated",
                    "bpm": state.bpm,
                    "spo2": state.spo2,
                    "systolic": state.systolic,
                    "diastolic": state.diastolic,
                    "audio_rms": state.audio_rms,
                    "audio_peak": state.audio_peak,
                    "timestamp": int(time.time() * 1000)
                })
                websockets.broadcast(state.connected_phones, packet)
                state.packets_sent += 1
            await asyncio.sleep(0.35)

    asyncio.create_task(broadcast_loop())
    async with websockets.serve(handler, "0.0.0.0", PORT):
        await asyncio.Future()

def run_ws_server():
    asyncio.run(ws_server_loop())

def terminal_display_loop():
    while state.running:
        os.system("cls" if os.name == "nt" else "clear")
        
        num_conn = len(state.connected_phones)
        scen_info = state.scenarios[state.scenario]
        status_txt = f"ENLAZADO A {num_conn} TELEFONO(S)" if num_conn > 0 else "ESPERANDO QUE TU TELEFONO SE CONECTE..."
        
        print("================================================================================")
        print("     SIMULADOR PC - DATOS SINTETICOS, SIN VALIDEZ CLINICA                          ")
        print("================================================================================")
        print(f" Dispositivo: {DEVICE_ID}  |  Puerto: {PORT}")
        print(f" Estado: {status_txt}")
        print(f" Escenario: {scen_info['name']}  |  Paquetes enviados: {state.packets_sent}\n")
        
        bpm_bar = "#" * min(20, int((state.bpm - 40) / 6))
        print("+------------------------------------------------------------------------------+")
        print("|  RITMO CARDIACO (BPM)        |  OXIGENO (SpO2)       |  PRESION ARTERIAL     |")
        print(f"|  {state.bpm:3d} BPM  [{bpm_bar:<15}]  |  {state.spo2:4.1f} %  (Demo)      |  {state.systolic:3d}/{state.diastolic:2d} mmHg          |")
        print("+------------------------------------------------------------------------------+")
        print("|  MICROFONO AMBIENTAL (I2S)   |  ESTRES AUTONOMO      |  ENLACE DIRECTO       |")
        print(f"|  {state.audio_rms:5.2f} dB (Pico: {state.audio_peak:5.2f} dB) |  Score: {state.stress:2d} / 100       |  ws://192.168.1.163:8765 |")
        print("+------------------------------------------------------------------------------+\n")
        
        print("CONTROLES DE TECLADO:")
        print("  [1] Reposo Normal          [2] Ejercicio / Taquicardia")
        print("  [3] Hipertension / Estres  [4] Hipoxia (Bajo Oxigeno)")
        print("  [5] Relajacion / Sueno     [Q] Salir del simulador\n")
        
        time.sleep(0.4)

def keyboard_listener_loop():
    try:
        import msvcrt
        while state.running:
            if msvcrt.kbhit():
                ch = msvcrt.getch()
                try:
                    char = ch.decode("utf-8").lower()
                except Exception:
                    continue
                    
                if char == '1':
                    state.scenario = "rest"
                elif char == '2':
                    state.scenario = "active"
                elif char == '3':
                    state.scenario = "hypertension"
                elif char == '4':
                    state.scenario = "hypoxia"
                elif char == '5':
                    state.scenario = "relax"
                elif char == 'q':
                    state.running = False
                    sys.exit(0)
            time.sleep(0.05)
    except Exception:
        pass

def main():
    t_phys = threading.Thread(target=physiological_engine_loop, daemon=True)
    t_phys.start()
    
    t_ws = threading.Thread(target=run_ws_server, daemon=True)
    t_ws.start()
    
    t_key = threading.Thread(target=keyboard_listener_loop, daemon=True)
    t_key.start()
    
    terminal_display_loop()

if __name__ == "__main__":
    main()
