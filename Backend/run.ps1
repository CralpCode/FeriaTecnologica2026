Write-Host "Iniciando Servidor Backend FastAPI en http://localhost:8000..." -ForegroundColor Cyan
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
