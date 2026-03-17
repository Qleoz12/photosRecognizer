@echo off
cd /d "%~dp0"

echo Liberando puertos 8732 y 5892...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8732 "') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5892 "') do taskkill /PID %%a /F >nul 2>&1
timeout /t 1 /nobreak >nul

echo Iniciando PhotosRecognizer...
echo.

start "API - PhotosRecognizer" cmd /k "python -m uvicorn api.main:app --host 0.0.0.0 --port 8732"
timeout /t 2 /nobreak >nul
start "Frontend - PhotosRecognizer" cmd /k "cd frontend && npm run dev -- --port 5892"

echo.
echo API:      http://localhost:8732
echo App:      http://localhost:5892
echo.
echo Cierra las ventanas o ejecuta stop.bat para detener.
