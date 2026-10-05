#!/usr/bin/env bash
# ==============================================================================
# SpiroScan "como hosting" en esta Mac, gratis:
#   - mantiene encendido el servidor (start_server.sh) y lo vuelve a levantar si se cae;
#   - dirección pública FIJA con Tailscale Funnel (https://spiroscan.<tailnet>.ts.net, no vence): si Funnel se
#     apaga, lo vuelve a encender. Sirve para la app y para el ESP32 desde cualquier red;
#   - si Tailscale no está disponible, usa un túnel rápido de Cloudflare y crea uno nuevo si Cloudflare lo tumba;
#   - publica el link vigente en GitHub Pages (rama gh-pages: index.html que redirige + link.json),
#     así la dirección fija nunca cambia: https://willor16.github.io/spiroscan/ (repo willor16/spiroscan, rama gh-pages)
#   - evita que la Mac se duerma mientras corre (caffeinate).
# Se deja corriendo siempre (ítem de inicio de sesión: "SpiroScan en línea.command").
# Variables opcionales: VENV, PORT, PAGES_DIR, CHECK_S
# ==============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
BASE="$(cd "$ROOT/.." && pwd)"
PORT="${PORT:-8000}"
VENV="${VENV:-$BASE/.venv}"
PAGES_DIR="${PAGES_DIR:-$BASE/pages}"
CHECK_S="${CHECK_S:-30}"
STATE="$BASE/tmp/en_linea"
CF="$(command -v cloudflared || echo "$BASE/bin/cloudflared")"
CF_LOG="$STATE/cloudflared.log"
TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"; [ -x "$TS" ] || TS="$(command -v tailscale || true)"
mkdir -p "$STATE"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$STATE/vigilante.log"; }

# Solo un vigilante a la vez
if [ -f "$STATE/vigilante.pid" ] && kill -0 "$(cat "$STATE/vigilante.pid")" 2>/dev/null; then
  echo "Ya hay un vigilante corriendo (PID $(cat "$STATE/vigilante.pid"))."; exit 0
fi
echo $$ > "$STATE/vigilante.pid"
caffeinate -dims -w $$ &   # la Mac no se duerme mientras el vigilante esté vivo

# PIDs del túnel rápido (con ps: pgrep/pkill no siempre ven el proceso en macOS)
cf_pids() { ps -axo pid=,command= | awk -v p="$PORT" '$0 ~ ("[c]loudflared tunnel --url http://localhost:" p) {print $1}'; }
cf_kill() { local p; for p in $(cf_pids); do kill "$p" 2>/dev/null; done; }
server_ok() { curl -sf -m 5 "http://localhost:$PORT/api/status" >/dev/null; }
tunnel_ok() { [ -n "${1:-}" ] && curl -sf -m 15 "$1/api/status" >/dev/null; }
current_url() { cat "$STATE/url" 2>/dev/null || true; }

start_server() {
  log "Servidor apagado: iniciando…"
  (cd "$ROOT" && VENV="$VENV" nohup ./start_server.sh >> "$BASE/tmp/servidor.log" 2>&1 &)
  for _ in $(seq 1 90); do server_ok && { log "Servidor en línea."; return 0; }; sleep 2; done
  log "El servidor no respondió en 3 minutos; se reintenta en la siguiente vuelta."
}

publish() {   # $1 = link vigente
  [ -d "$PAGES_DIR/.git" ] || { log "Sin carpeta de GitHub Pages ($PAGES_DIR): no se publica."; return; }
  local now; now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf '{"url": "%s", "actualizado": "%s"}\n' "$1" "$now" > "$PAGES_DIR/link.json"
  sed "s#__URL__#$1#g" "$PAGES_DIR/plantilla.html" > "$PAGES_DIR/index.html"
  (cd "$PAGES_DIR" && git add index.html link.json && git commit -qm "link vigente $now" && git push -q origin gh-pages) \
    && log "Publicado en GitHub Pages: $1" || log "No se pudo publicar en GitHub Pages (se reintenta al cambiar el link)."
}

start_tunnel() {
  log "Túnel caído o inexistente: creando uno nuevo…"
  cf_kill; sleep 1
  : > "$CF_LOG"
  nohup "$CF" tunnel --url "http://localhost:$PORT" >> "$CF_LOG" 2>&1 &
  local url=""
  for _ in $(seq 1 60); do
    url="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$CF_LOG" | grep -v 'api\.' | head -1)"
    [ -n "$url" ] && break; sleep 1
  done
  [ -z "$url" ] && { log "Cloudflare no entregó un link; se reintenta."; return 1; }
  for _ in $(seq 1 40); do tunnel_ok "$url" && break; sleep 3; done   # el DNS del link nuevo tarda un poco
  echo "$url" > "$STATE/url"
  log "Túnel nuevo: $url"
  publish "$url"
}

# --- Tailscale Funnel: dirección fija ---
funnel_url() { [ -n "$TS" ] && "$TS" funnel status 2>/dev/null | grep -o 'https://[a-z0-9.-]*\.ts\.net' | head -1; }
ensure_funnel() {
  [ -n "$(funnel_url)" ] && return 0
  log "Funnel apagado: encendiéndolo…"
  "$TS" funnel --bg "$PORT" >/dev/null 2>&1 < /dev/null
  [ -n "$(funnel_url)" ] && log "Funnel en línea: $(funnel_url)"
}
if [ -n "$TS" ] && [ -n "$(funnel_url)" ]; then
  FIXED="$(funnel_url)"; FIXED="${FIXED%/}"
  log "Vigilante iniciado con Tailscale Funnel (dirección fija): $FIXED"
  if [ "$(current_url)" != "$FIXED" ]; then echo "$FIXED" > "$STATE/url"; publish "$FIXED"; fi
  cf_kill   # ya no hace falta el túnel rápido
  while true; do
    server_ok || start_server
    ensure_funnel
    sleep "$CHECK_S"
  done
fi

# Al arrancar se adopta el túnel que ya exista (si responde) para no cambiar el link sin necesidad
if [ -z "$(current_url)" ] && [ -f /tmp/cloudflared.log ]; then
  grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/cloudflared.log | grep -v 'api\.' | head -1 > "$STATE/url"
fi
log "Vigilante iniciado (revisa cada $CHECK_S s). Link actual: $(current_url)"
[ -n "$(current_url)" ] && [ ! -f "$STATE/publicado" ] && { publish "$(current_url)"; touch "$STATE/publicado"; }

fails=0
while true; do
  server_ok || start_server
  if [ -n "$(cf_pids)" ] && tunnel_ok "$(current_url)"; then
    fails=0
  else
    fails=$((fails + 1))
    # 3 fallos seguidos (~1.5 min): evita cambiar el link por un corte momentáneo de internet
    if [ "$fails" -ge 3 ] || [ -z "$(cf_pids)" ]; then
      server_ok && start_tunnel && fails=0
    fi
  fi
  sleep "$CHECK_S"
done
