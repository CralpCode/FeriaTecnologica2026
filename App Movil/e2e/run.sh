#!/usr/bin/env bash
# Prueba automática de la consulta: exporta la app, levanta un servidor AISLADO y corre Playwright.
# Nada toca los datos reales: base, grabaciones e informes van a una carpeta temporal que se borra al final.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$APP/.." && pwd)"
PORT="${E2E_PORT:-8011}"
VENV="${VENV:-$HOME/Documents/spirosan/.venv}"
PY="$VENV/bin/python"; [ -x "$PY" ] || PY="python3"
TMP="$(mktemp -d)"
cleanup() { [ -n "${SERVER:-}" ] && kill "$SERVER" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "[e2e] Exportando la app…"
(cd "$APP" && CI=1 npx expo export --platform web --output-dir "$TMP/dist" >/dev/null)

echo "[e2e] Servidor aislado en el puerto ${PORT}…"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[e2e] El puerto $PORT ya está en uso; cierra ese proceso o usa E2E_PORT=otro"; exit 1
fi
mkdir -p "$TMP/recordings" "$TMP/reports"
# exec: el proceso en segundo plano ES el servidor, así el trap lo detiene de verdad
(cd "$ROOT/Backend" && exec env SPIROSCAN_DB_PATH="$TMP/e2e.db" SPIROSCAN_REC_DIR="$TMP/recordings" \
  SPIROSCAN_REPORT_DIR="$TMP/reports" SPIROSCAN_MDNS=0 SPIROSCAN_BACKUP_MIN=0 LLM_BASE_URL="http://127.0.0.1:9/v1" \
  APP_DIST="$TMP/dist" "$PY" -m uvicorn main:app --host 127.0.0.1 --port "$PORT" > "$TMP/server.log" 2>&1) &
SERVER=$!
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/api/status" >/dev/null && break; sleep 1; done
curl -sf "http://127.0.0.1:$PORT/api/status" >/dev/null || { cat "$TMP/server.log"; echo "[e2e] El servidor no arrancó"; exit 1; }

cd "$APP"
E2E_BASE_URL="http://127.0.0.1:$PORT" npx playwright test "$@"
