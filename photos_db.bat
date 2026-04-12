@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================================
REM  photos_db.bat — Un solo punto de entrada para la base SQLite (photos.db)
REM
REM  Modo por defecto (sin subcomando): igual que index_and_cluster.bat
REM    - Cierra Python, mueve wal/shm a respaldo, indexado INCREMENTAL, cluster
REM
REM  Subcomandos:
REM    recreate   Mueve photos.db+wav+shm a data\db_backup\ y reindexa --force
REM    snapshot   Copia la BD actual a data\db_backup\snapshot_<fecha>\ (cierra API antes)
REM    recover    sqlite3 .recover: entrada [salida]
REM    help       Esta ayuda
REM
REM  Ejemplos:
REM    photos_db.bat
REM    photos_db.bat 4
REM    photos_db.bat "D:\Fotos" 4
REM    photos_db.bat recreate
REM    photos_db.bat recreate 4
REM    photos_db.bat recreate "D:\Fotos" 4
REM    photos_db.bat snapshot
REM    photos_db.bat recover "C:\descargas\vieja.db"
REM    photos_db.bat recover "mala.db" "data\photos_recovered.db"
REM ============================================================================

if /i "%~1"=="help" goto :help
if /i "%~1"=="/?" goto :help
if /i "%~1"=="--help" goto :help
if /i "%~1"=="recreate" goto :recreate
if /i "%~1"=="snapshot" goto :snapshot
if /i "%~1"=="recover" goto :recover
goto :index

:help
echo.
echo === photos_db.bat — Base de datos PhotosRecognizer ===
echo.
echo [Por defecto] Indexado incremental + agrupar caras (rostros):
echo   photos_db.bat
echo   photos_db.bat 4
echo   photos_db.bat "CARPETA_FOTOS"
echo   photos_db.bat "CARPETA_FOTOS" 4
echo.
echo recreate — Respaldar BD actual ^(mover, no borrar^) y reindexar TODO ^(--force^^):
echo   photos_db.bat recreate
echo   photos_db.bat recreate 4
echo   photos_db.bat recreate "CARPETA" 4
echo.
echo snapshot — Copia de seguridad sin reindexar ^(recomendado: API cerrada^):
echo   photos_db.bat snapshot
echo.
echo recover — SQLite .recover ^(archivo corrupto pero cabecera SQLite^):
echo   photos_db.bat recover "entrada.db" ["salida.db"]
echo   Por defecto salida: data\photos_recovered.db
echo.
echo Otros scripts: setup.bat, start.bat, stop.bat, update_paths.bat
echo.
pause
exit /b 0

:snapshot
for /f %%t in ('python -c "from datetime import datetime; print(datetime.now().strftime('%%Y-%%m-%%d_%%H-%%M-%%S'))"') do set "TSTAMP=%%t"
set "SNAPDIR=data\db_backup\snapshot_%TSTAMP%"
echo.
echo === SNAPSHOT: copia de photos.db a ===
echo    %SNAPDIR%\
echo.
echo Cierra la API si esta abierta ^(evita archivo en uso^).
pause
if not exist "data\photos.db" (
    echo No existe data\photos.db — nada que copiar.
    pause
    exit /b 1
)
mkdir "%SNAPDIR%" 2>nul
copy /Y "data\photos.db" "%SNAPDIR%\photos.db" >nul
if exist "data\photos.db-wal" copy /Y "data\photos.db-wal" "%SNAPDIR%\" >nul
if exist "data\photos.db-shm" copy /Y "data\photos.db-shm" "%SNAPDIR%\" >nul
echo Listo. Copia en: %SNAPDIR%
pause
exit /b 0

:recover
set "INFILE=%~2"
set "OUTFILE=%~3"
if "%INFILE%"=="" (
    echo Falta archivo de entrada.
    echo Uso: photos_db.bat recover "entrada.db" ["salida.db"]
    pause
    exit /b 1
)
if not exist "%INFILE%" (
    echo No existe: %INFILE%
    pause
    exit /b 1
)
if "%OUTFILE%"=="" set "OUTFILE=data\photos_recovered.db"
if exist "%OUTFILE%" (
    echo Ya existe %OUTFILE% — mueve o borra antes.
    pause
    exit /b 1
)
if not exist "logs" mkdir "logs"
for /f %%t in ('python -c "from datetime import datetime; print(datetime.now().strftime('%%Y-%%m-%%d_%%H-%%M-%%S'))"') do set "RTSTAMP=%%t"
set "ERRLOG=logs\recover_%RTSTAMP%.log"
echo Entrada: %INFILE%
echo Salida:  %OUTFILE%
echo Log err: %ERRLOG%
sqlite3 "%INFILE%" ".recover" 2>"%ERRLOG%" | sqlite3 "%OUTFILE%"
if errorlevel 1 (
    echo recover fallo. Revisa %ERRLOG%
    pause
    exit /b 1
)
echo Hecho. Prueba: sqlite3 "%OUTFILE%" "PRAGMA integrity_check;"
pause
exit /b 0

:recreate
set "ARG1=%~2"
set "ARG2=%~3"
set "WORKERS=%ARG2%"
if "%WORKERS%"=="" (
    echo %ARG1%| findstr /r "^[0-9][0-9]*$" >nul 2>&1
    if errorlevel 1 (
        set "WORKERS=2"
        set "ROOT=%ARG1%"
    ) else (
        set "WORKERS=%ARG1%"
        set "ROOT="
    )
) else (
    set "ROOT=%ARG1%"
)
for /f %%t in ('python -c "from datetime import datetime; print(datetime.now().strftime('%%Y-%%m-%%d_%%H-%%M-%%S'))"') do set "TSTAMP=%%t"
set "BAKDIR=data\db_backup\backup_%TSTAMP%"
set "LOGFILE=%~dp0logs\index_recreate_%TSTAMP%.log"
echo.
echo === RECREAR BD — respaldo en ===
echo    %BAKDIR%\
echo    Workers: %WORKERS%
echo Cierra la API. Ctrl+C para cancelar.
pause
if not exist "logs" mkdir "logs"
mkdir "%BAKDIR%" 2>nul
echo Cerrando Python...
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM python3.exe >nul 2>&1
timeout /t 2 /nobreak >nul
if exist "data\photos.db" move /Y "data\photos.db" "%BAKDIR%\photos.db"
if exist "data\photos.db-wal" move /Y "data\photos.db-wal" "%BAKDIR%\"
if exist "data\photos.db-shm" move /Y "data\photos.db-shm" "%BAKDIR%\"
if not exist "data\photos" mkdir "data\photos"
echo Log: %LOGFILE%
if "%ROOT%"=="" (
    powershell -NoProfile -Command "python -m indexer.run --workers %WORKERS% --force 2>&1 | Tee-Object -FilePath '%LOGFILE%'"
) else (
    powershell -NoProfile -Command "python -m indexer.run --root '%ROOT%' --workers %WORKERS% --force 2>&1 | Tee-Object -FilePath '%LOGFILE%'"
)
if errorlevel 1 (
    echo [ERROR] Indexado fallo. Copia anterior: %BAKDIR%
    pause
    exit /b 1
)
powershell -NoProfile -Command "python -m clustering.cluster_faces 2>&1 | Tee-Object -FilePath '%LOGFILE%' -Append"
echo Listo. Nueva BD: data\photos.db
pause
exit /b 0

:index
set "ARG1=%~1"
set "ARG2=%~2"
set "WORKERS=%ARG2%"
if "%WORKERS%"=="" (
    echo %ARG1%| findstr /r "^[0-9][0-9]*$" >nul 2>&1
    if errorlevel 1 (
        set "WORKERS=2"
        set "ROOT=%ARG1%"
    ) else (
        set "WORKERS=%ARG1%"
        set "ROOT="
    )
) else (
    set "ROOT=%ARG1%"
)
if not exist "logs" mkdir "logs"
for /f %%t in ('python -c "from datetime import datetime; print(datetime.now().strftime('%%Y-%%m-%%d_%%H-%%M-%%S'))"') do set "TSTAMP=%%t"
set "LOGFILE=%~dp0logs\index_%TSTAMP%.log"
echo Logs: %LOGFILE%
echo.
echo Cerrando procesos Python...
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM python3.exe >nul 2>&1
timeout /t 2 /nobreak >nul
set "WALBAK=data\db_backup\wal_%TSTAMP%"
mkdir "%WALBAK%" 2>nul
if exist "data\photos.db-wal" move /Y "data\photos.db-wal" "%WALBAK%\"
if exist "data\photos.db-shm" move /Y "data\photos.db-shm" "%WALBAK%\"
echo.
echo === Indexado incremental + cluster ===
echo Workers: %WORKERS%
echo.
if not exist "data\photos" mkdir "data\photos"
if "%ROOT%"=="" (
    echo Carpeta: data\photos
    powershell -NoProfile -Command "python -m indexer.run --workers %WORKERS% 2>&1 | Tee-Object -FilePath '%LOGFILE%'"
) else (
    echo Carpeta: %ROOT%
    powershell -NoProfile -Command "python -m indexer.run --root '%ROOT%' --workers %WORKERS% 2>&1 | Tee-Object -FilePath '%LOGFILE%'"
)
if errorlevel 1 (
    echo [ERROR] Revisa logs\index_*.log
    pause
    exit /b 1
)
echo.
echo === Agrupando rostros ===
powershell -NoProfile -Command "python -m clustering.cluster_faces 2>&1 | Tee-Object -FilePath '%LOGFILE%' -Append"
echo.
echo Listo. http://localhost:5892
pause
exit /b 0
