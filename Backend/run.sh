#!/bin/bash
# Script de inicio rápido para macOS / Linux (FastAPI + IA SpiroScan)
cd "$(dirname "$0")"

if [ -d ".venv" ]; then
    source .venv/bin/activate
elif [ -d "../code/.venv" ]; then
    source ../code/.venv/bin/activate
elif [ -d "../../code/.venv" ]; then
    source ../../code/.venv/bin/activate
fi

echo "🚀 Iniciando Servidor Backend FastAPI en http://localhost:8000..."
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
