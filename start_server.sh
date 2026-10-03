#!/usr/bin/env bash
# ==============================================================================
# Servidor SpiroScan en la Mac: Ollama (LLM) + Backend FastAPI + App web, todo en un comando.
#   ./start_server.sh            -> red local (la app se abre en http://spiroscan.local:8000)
#   ./start_server.sh --build    -> además recompila la app web (después de cambiar la app)
#   ./start_server.sh --tunnel   -> además publica la app en internet (túnel de Cloudflare, https)
# Variables opcionales: VENV (entorno Python), LLM_MODEL, PORT
# ==============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/Backend"

PORT="${PORT:-8000}"
VENV="${VENV:-$(pwd)/.venv}"
export LLM_MODEL="${LLM_MODEL:-qwen3:32b}"
export PORT
BUILD=0; TUNNEL=0
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    --tunnel) TUNNEL=1 ;;
  esac
done

if [ ! -x "$VENV/bin/python" ]; then
  echo "[*] Creando entorno Python en $VENV ..."
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -r requirements.txt
fi

# App web: se compila una vez (o con --build) y la sirve el mismo backend.
APP_DIR="$ROOT/App Movil"
if [ "$BUILD" = 1 ] || [ ! -f "$APP_DIR/dist/index.html" ]; then
  echo "[*] Compilando la app web ..."
  (cd "$APP_DIR" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && CI=1 npx expo export --platform web >/dev/null)
fi

if ! curl -s localhost:11434/api/version >/dev/null; then
  echo "[*] Iniciando Ollama ..."
  (open -a Ollama 2>/dev/null || (ollama serve >/tmp/ollama.log 2>&1 &))
  for _ in $(seq 1 20); do curl -s localhost:11434/api/version >/dev/null && break; sleep 1; done
fi
echo "[OK] Ollama activo · modelo $LLM_MODEL"
# Precarga el modelo en memoria para que la primera respuesta no tarde.
curl -s localhost:11434/api/generate -d "{\"model\":\"$LLM_MODEL\",\"keep_alive\":\"24h\"}" >/dev/null || true

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '127.0.0.1')"
URL="http://$IP:$PORT"
echo
echo "=============================================================="
echo "  App SpiroScan:   http://spiroscan.local:$PORT"
echo "  (si ese nombre no abre en algún celular: $URL)"
echo "  API y docs:      $URL/docs"
echo "  El ESP32 encuentra este servidor solo (mDNS)."
echo "=============================================================="
"$VENV/bin/python" -c "import qrcode,sys; q=qrcode.QRCode(border=1); q.add_data(sys.argv[1]); q.print_ascii(invert=True)" "$URL" 2>/dev/null \
  || echo "(instala 'qrcode' en el entorno para ver el código QR)"
echo "  Escanea el QR con el celular conectado al mismo WiFi."
echo

if [ "$TUNNEL" = 1 ]; then
  CLOUDFLARED="$(command -v cloudflared || echo "$ROOT/../bin/cloudflared")"
  if [ -x "$CLOUDFLARED" ]; then
    pkill -f "cloudflared tunnel --url http://localhost:$PORT" 2>/dev/null || true
    "$CLOUDFLARED" tunnel --url "http://localhost:$PORT" >/tmp/cloudflared.log 2>&1 &
    for _ in $(seq 1 90); do grep -q "trycloudflare.com" /tmp/cloudflared.log && break; sleep 1; done
    PUBLIC_URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/cloudflared.log | head -1 || true)"
    echo "$PUBLIC_URL" > "$ROOT/Backend/.public_url"
    echo "=============================================================="
    echo "  DESDE CUALQUIER RED (datos móviles, otra casa):"
    echo "  $PUBLIC_URL"
    echo "  (este enlace cambia cada vez que se reinicia el túnel)"
    echo "=============================================================="
    "$VENV/bin/python" -c "import qrcode,sys; q=qrcode.QRCode(border=1); q.add_data(sys.argv[1]); q.print_ascii(invert=True)" "$PUBLIC_URL" 2>/dev/null || true
  else
    echo "[!] No se encontró cloudflared (descárgalo en ~/Documents/spirosan/bin)."
  fi
fi

# caffeinate evita que la Mac se duerma mientras el servidor está activo.
exec caffeinate -dimsu "$VENV/bin/python" -m uvicorn main:app --host 0.0.0.0 --port "$PORT"
