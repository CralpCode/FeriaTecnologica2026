import asyncio
import json
import math
import random
import time
import websockets

PORT = 8765
DEVICE_NAME = "SpiroScan-Band (ESP32)"
DEVICE_MAC = "C4:4F:33:1A:89:BC"

# Estado interno de los sensores de la pulsera
sensor_state = {
    "bpm": 74,
    "spo2": 98.4,
    "systolic": 118,
    "diastolic": 76,
    "audio_rms": 18.5,
    "audio_peak": 28.0,
    "battery": 94,
    "scenario": "rest"
}

connected_phones = set()

async def sensor_simulation_loop():
    while True:
        now = time.time()
        base_bpm = 74 if sensor_state["scenario"] == "rest" else 122
        base_spo2 = 98.5 if sensor_state["scenario"] == "rest" else 96.8
        
        # Oscilaciones fisiológicas reales
        sinus = 5.0 * math.sin(now * 1.5)
        mayer = 3.0 * math.cos(now * 0.6)
        
        sensor_state["bpm"] = int(base_bpm + sinus + mayer + random.uniform(-1, 1))
        sensor_state["spo2"] = round(base_spo2 + 0.5 * math.sin(now * 0.8) + random.uniform(-0.1, 0.1), 1)
        sensor_state["systolic"] = int(118 + (sensor_state["bpm"] - 74) * 0.4 + random.uniform(-2, 2))
        sensor_state["diastolic"] = int(76 + (sensor_state["bpm"] - 74) * 0.2 + random.uniform(-1, 1))
        sensor_state["audio_rms"] = round(16.0 + 6.0 * math.sin(now * 1.1) + random.uniform(0, 5), 2)
        sensor_state["audio_peak"] = round(sensor_state["audio_rms"] * 1.35, 2)
        
        # Si hay teléfonos conectados directamente a la pulsera, enviar paquete de sensor
        if connected_phones:
            raw_packet = json.dumps({
                "type": "RAW_SENSOR_DATA",
                "device": DEVICE_NAME,
                "mac": DEVICE_MAC,
                "battery": sensor_state["battery"],
                "data": {
                    "bpm": sensor_state["bpm"],
                    "spo2": sensor_state["spo2"],
                    "systolic": sensor_state["systolic"],
                    "diastolic": sensor_state["diastolic"],
                    "audio_rms": sensor_state["audio_rms"],
                    "audio_peak": sensor_state["audio_peak"],
                },
                "timestamp": int(time.time() * 1000)
            })
            
            # Difundir a los teléfonos conectados
            websockets.broadcast(connected_phones, raw_packet)
            
        await asyncio.sleep(0.35)

async def handle_phone_connection(websocket):
    connected_phones.add(websocket)
    client_ip = websocket.remote_address[0]
    print(f"\r\n[ENLACE DIRECTO OK] Teléfono conectado a la pulsera desde {client_ip}!")
    
    # Enviar paquete de bienvenida del dispositivo
    await websocket.send(json.dumps({
        "type": "DEVICE_HANDSHAKE",
        "device": DEVICE_NAME,
        "mac": DEVICE_MAC,
        "protocol": "BLE_DIRECT_STREAM_v1.4",
        "battery": sensor_state["battery"]
    }))
    
    try:
        async for message in websocket:
            # Comandos que el teléfono le puede enviar a la pulsera
            try:
                cmd = json.loads(message)
                if cmd.get("command") == "SET_SCENARIO":
                    sensor_state["scenario"] = cmd.get("scenario", "rest")
                    print(f"[*] Escenario cambiado desde el teléfono a: {sensor_state['scenario']}")
            except:
                pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_phones.remove(websocket)
        print(f"[-] Teléfono desconectado de la pulsera ({client_ip}).")

async def main():
    print("=" * 75)
    print(f"  PULSERA INTELIGENTE {DEVICE_NAME} - SERVIDOR DE ENLACE DIRECTO (BLE/LOCAL)")
    print(f"  Esperando que la App Móvil se conecte directamente en el puerto {PORT}...")
    print("=" * 75)
    
    asyncio.create_task(sensor_simulation_loop())
    
    async with websockets.serve(handle_phone_connection, "0.0.0.0", PORT):
        await asyncio.Future()  # Mantener corriendo

if __name__ == "__main__":
    asyncio.run(main())
