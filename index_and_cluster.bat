@echo off
cd /d "%~dp0"

REM Usage:
REM   index_and_cluster.bat              -> scans data\photos\, 2 workers
REM   index_and_cluster.bat 4            -> scans data\photos\, 4 workers
REM   index_and_cluster.bat "V:\Album"   -> scans custom path, 2 workers
REM   index_and_cluster.bat "V:\Album" 4 -> scans custom path, 4 workers

set "ARG1=%~1"
set "ARG2=%~2"
set WORKERS=%ARG2%
if "%WORKERS%"=="" (
    REM Solo un argumento: si es numero, son workers; si no, es ruta
    echo %ARG1%| findstr /r "^[0-9][0-9]*$" >nul 2>&1
    if errorlevel 1 (
        set WORKERS=2
        set "ROOT=%ARG1%"
    ) else (
        set WORKERS=%ARG1%
        set "ROOT="
    )
) else (
    set "ROOT=%ARG1%"
)

REM Crear carpeta logs y generar nombre de archivo con timestamp
if not exist "logs" mkdir "logs"
for /f %%t in ('python -c "from datetime import datetime; print(datetime.now().strftime('%%Y-%%m-%%d_%%H-%%M-%%S'))"') do set TSTAMP=%%t
set "LOGFILE=%~dp0logs\index_%TSTAMP%.log"
echo Logs: %LOGFILE%
echo.

echo Cerrando procesos Python anteriores...
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM python3.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM Limpiar solo lock files de SQLite (NO borrar la base de datos)
del /F /Q "data\photos.db-wal" >nul 2>&1
del /F /Q "data\photos.db-shm" >nul 2>&1

echo.
echo ============================================================
echo  PhotosRecognizer - Indexado incremental
echo  Workers: %WORKERS%
echo  (Ctrl+C para pausar - puedes retomar cuando quieras)
echo ============================================================
echo.

if not exist "data\photos" mkdir "data\photos"

if "%ROOT%"=="" (
    echo Carpeta: data\photos\
    powershell -NoProfile -Command "python -m indexer.run --workers %WORKERS% 2>&1 | Tee-Object -FilePath '%LOGFILE%'"
) else (
    echo Carpeta: %ROOT%
    powershell -NoProfile -Command "python -m indexer.run --root '%ROOT%' --workers %WORKERS% 2>&1 | Tee-Object -FilePath '%LOGFILE%'"
)

if errorlevel 1 (
    echo.
    echo [ERROR] El indexado termino con errores. Revisa logs\index_*.log
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Agrupando rostros detectados...
echo ============================================================
powershell -NoProfile -Command "python -m clustering.cluster_faces 2>&1 | Tee-Object -FilePath '%LOGFILE%' -Append"

echo.
echo ============================================================
echo  Listo. Abre http://localhost:5892
echo  Logs guardados en: logs\
echo ============================================================
pause
