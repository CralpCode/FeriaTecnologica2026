"""
Anuncia el servidor en la red local (mDNS / Bonjour) para que nadie tenga que escribir la IP:
  - Servicio  _spiroscan._tcp  -> el ESP32 lo busca con MDNS.queryService("spiroscan", "tcp").
  - Nombre    spiroscan.local  -> los celulares y PCs abren http://spiroscan.local:8000
Funciona igual en casa o en la feria, aunque el router asigne otra IP a la Mac.
"""
import os
import socket

from zeroconf import IPVersion, ServiceInfo
from zeroconf.asyncio import AsyncZeroconf

HOSTNAME = os.getenv("MDNS_HOSTNAME", "spiroscan")
_zc: AsyncZeroconf | None = None


def local_ip() -> str:
    """IP de la Mac en la red WiFi/LAN (la de la interfaz que sale a la red)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


async def start(port: int) -> dict:
    global _zc
    ip = local_ip()
    info = ServiceInfo(
        "_spiroscan._tcp.local.",
        f"SpiroScan Server._spiroscan._tcp.local.",
        addresses=[socket.inet_aton(ip)],
        port=port,
        properties={"path": "/", "api": "/api"},
        server=f"{HOSTNAME}.local.",
    )
    try:
        _zc = AsyncZeroconf(ip_version=IPVersion.V4Only)
        await _zc.async_register_service(info, allow_name_change=True)
        print(f"[mDNS] Anunciado como http://{HOSTNAME}.local:{port}  (IP {ip})")
    except Exception as e:
        print(f"[mDNS] No se pudo anunciar el servidor: {type(e).__name__} {e}")
    return {"ip": ip, "hostname": f"{HOSTNAME}.local", "port": port}


async def stop():
    global _zc
    if _zc:
        await _zc.async_unregister_all_services()
        await _zc.async_close()
        _zc = None
