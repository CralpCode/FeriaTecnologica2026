"""
Contraseña SOLO para accesos desde internet (túnel de Cloudflare).

Cloudflare agrega la cabecera `cf-connecting-ip` a todo lo que llega por el túnel; lo que viene de
la red local (ESP32, celulares en el mismo WiFi, la propia Mac) no la trae y pasa sin contraseña.
Usuario y contraseña se leen de REMOTE_USER / REMOTE_PASSWORD (Backend/.env). Si REMOTE_PASSWORD
está vacío, el acceso remoto queda BLOQUEADO en lugar de abierto.
"""
import base64
import os
import secrets


class RemoteAuthMiddleware:
    def __init__(self, app):
        self.app = app
        self.user = os.getenv("REMOTE_USER", "spiroscan")
        self.password = os.getenv("REMOTE_PASSWORD", "")

    def _authorized(self, headers: dict[bytes, bytes]) -> bool:
        if b"cf-connecting-ip" not in headers:
            return True  # red local
        if not self.password:
            return False
        auth = headers.get(b"authorization", b"").decode("latin-1")
        if not auth.lower().startswith("basic "):
            return False
        try:
            user, _, pwd = base64.b64decode(auth[6:]).decode("utf-8").partition(":")
        except Exception:
            return False
        return secrets.compare_digest(user, self.user) and secrets.compare_digest(pwd, self.password)

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers") or [])
        if self._authorized(headers):
            return await self.app(scope, receive, send)

        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4401})
            return
        await send({
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"www-authenticate", b'Basic realm="SpiroScan", charset="UTF-8"'),
                (b"content-type", b"text/plain; charset=utf-8"),
            ],
        })
        await send({"type": "http.response.body", "body": "Acceso remoto a SpiroScan: se requiere contraseña.".encode()})
