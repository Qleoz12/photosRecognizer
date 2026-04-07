@echo off
cd /d "%~dp0"

echo Liberando puertos 8732, 18733, 18734 y 5892...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8732 "') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":18733 "') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":18734 "') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5892 "') do taskkill /PID %%a /F >nul 2>&1
timeout /t 1 /nobreak >nul

echo Iniciando PhotosRecognizer (gateway + API lectura + API escritura)...
echo.

REM Pool de lectura: N workers, SQLite mode=ro (PHOTOS_API_MODE=read)
if "%API_READ_WORKERS%"=="" set API_READ_WORKERS=4
echo Workers solo-lectura: %API_READ_WORKERS% ^| Escritura: 1 proceso ^| Puerto publico: 8732 ^(gateway^)

REM Archivo (fotos ocultas + /archive): PIN de 7 digitos. Cambia antes de start o en archivo .env en la raiz.
if "%ARCHIVE_PIN%"=="" set ARCHIVE_PIN=1234567
echo Archivo: PIN activo ^(cambia ARCHIVE_PIN o .env si quieres otro^)

REM Orden: primero escritura (migraciones), luego lectura, luego gateway.
REM timeout-keep-alive 300 = peticiones largas (find-similar CLIP ~5 min)
start "API-write - PhotosRecognizer" cmd /k "cd /d %~dp0 && set PHOTOS_API_MODE=write&& python -m uvicorn api.main:app --host 127.0.0.1 --port 18733 --workers 1 --timeout-keep-alive 300"
timeout /t 2 /nobreak >nul
start "API-read - PhotosRecognizer" cmd /k "cd /d %~dp0 && set PHOTOS_API_MODE=read&& python -m uvicorn api.main:app --host 127.0.0.1 --port 18734 --workers %API_READ_WORKERS% --timeout-keep-alive 300"
timeout /t 2 /nobreak >nul
start "API-gateway - PhotosRecognizer" cmd /k "cd /d %~dp0 && python -m uvicorn api.gateway:app --host 0.0.0.0 --port 8732 --workers 1 --timeout-keep-alive 300"
timeout /t 2 /nobreak >nul
start "Frontend - PhotosRecognizer" cmd /k "cd frontend && npm run dev -- --port 5892"

echo.
echo API ^(gateway^): http://localhost:8732
echo App:            http://localhost:5892
echo.
echo Sin gateway ^(solo dev^): uvicorn api.main:app --port 8732 ^(no definas PHOTOS_API_MODE^)
echo Cierra las ventanas o ejecuta stop.bat para detener.
