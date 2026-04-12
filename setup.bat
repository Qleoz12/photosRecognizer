@echo off
cd /d "%~dp0"

echo ============================================================
echo  PhotosRecognizer - Configuracion inicial
echo ============================================================
echo.

REM Crear carpeta para fotos si no existe
if not exist "data\photos" (
    mkdir "data\photos"
    echo Carpeta creada: data\photos\
    echo Copia aqui tus fotos y videos.
    echo.
) else (
    echo Carpeta data\photos\ ya existe.
    echo.
)

REM Instalar dependencias Python
echo Instalando dependencias Python...
pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] pip install fallo.
    pause
    exit /b 1
)
echo.

REM Instalar dependencias frontend
echo Instalando dependencias del frontend...
cd frontend
call npm install --ignore-scripts
if errorlevel 1 (
    echo [ERROR] npm install fallo.
    cd ..
    pause
    exit /b 1
)

REM Crear .env si no existe
if not exist ".env" (
    copy .env.example .env
    echo Archivo .env creado (API en http://localhost:8732)
) else (
    echo Archivo .env ya existe.
)
cd ..
echo.

echo ============================================================
echo  Configuracion completada.
echo.
echo  Siguiente:
echo  1. Copia tus fotos y videos en data\photos\
echo  2. Ejecuta: photos_db.bat   (o index_and_cluster.bat, es lo mismo)
echo  3. Ejecuta: start.bat
echo  4. Abre: http://localhost:5892
echo ============================================================
pause
