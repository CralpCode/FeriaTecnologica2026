#!/bin/zsh
set -eu
DIR="${0:A:h}"
PORT="${1:-/dev/cu.usbserial-0001}"
"$DIR/../../.venv/bin/python" -m platformio run -d "$DIR" --target upload --upload-port "$PORT"
