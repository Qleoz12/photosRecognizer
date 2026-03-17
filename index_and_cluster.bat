@echo off
cd /d "%~dp0"

REM Usage:
REM   index_and_cluster.bat              -> scans data\photos\, 2 workers
REM   index_and_cluster.bat "V:\Album"   -> scans custom path, 2 workers
REM   index_and_cluster.bat "V:\Album" 4 -> scans custom path, 4 workers

set WORKERS=%~2
if "%WORKERS%"=="" set WORKERS=2

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

if "%~1"=="" (
    echo Carpeta: data\photos\
    python -m indexer.run --workers %WORKERS%
) else (
    echo Carpeta: %~1
    python -m indexer.run --root "%~1" --workers %WORKERS%
)

if errorlevel 1 (
    echo.
    echo [ERROR] El indexado termino con errores. Revisa los mensajes arriba.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Agrupando rostros detectados...
echo ============================================================
python -m clustering.cluster_faces

echo.
echo ============================================================
echo  Listo. Abre http://localhost:5892
echo ============================================================
pause
