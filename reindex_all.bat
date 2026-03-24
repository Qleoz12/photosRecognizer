@echo off
cd /d "%~dp0"

echo ADVERTENCIA: Esto borrara todos los datos indexados y comenzara desde cero.
echo Presiona Ctrl+C para cancelar o cualquier tecla para continuar...
pause >nul

echo Cerrando procesos anteriores...
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM python3.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Borrando base de datos...
del /F /Q "data\photos.db" >nul 2>&1
del /F /Q "data\photos.db-wal" >nul 2>&1
del /F /Q "data\photos.db-shm" >nul 2>&1

echo Indexando desde cero...
if "%1"=="" (
    python -m indexer.run --force
) else (
    python -m indexer.run --root "%1" --force
)

echo.
echo Agrupando rostros...
python -m clustering.cluster_faces

echo.
echo Listo. Abre http://localhost:5892 para ver los resultados.
pause
