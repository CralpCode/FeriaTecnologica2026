#!/bin/zsh
set -eu
DIR="${0:A:h}"
"$DIR/../../.venv/bin/python" -m platformio run -d "$DIR"
