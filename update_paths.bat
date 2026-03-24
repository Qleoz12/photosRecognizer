@echo off
cd /d "%~dp0"

REM Actualiza las rutas en la base de datos despues de mover fotos a otro disco.
REM Uso: update_paths.bat "D:\Photos" "E:\Photos"
REM      (ruta antigua)    (ruta nueva)

if "%~1"=="" (
    echo Uso: update_paths.bat "RUTA_ANTIGUA" "RUTA_NUEVA"
    echo Ejemplo: update_paths.bat "D:\Photos" "E:\Photos"
    pause
    exit /b 1
)

if "%~2"=="" (
    echo Falta la ruta nueva.
    echo Uso: update_paths.bat "RUTA_ANTIGUA" "RUTA_NUEVA"
    pause
    exit /b 1
)

echo Actualizando rutas en la base de datos...
python -m indexer.run --update-paths "%~1" "%~2"

echo.
pause
