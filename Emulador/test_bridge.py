import asyncio
import websockets
import json
import requests
import time

# Stub de conectividad: no recibe ni emite telemetría.
# Cualquier extensión para Wokwi/PC debe conservar source="simulated" y test=true.
print("Verificando conectividad local...")
