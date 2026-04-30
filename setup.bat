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

REM Instalar dependencias frontend (solo pnpm; ver frontend/package.json preinstall)
echo Instalando dependencias del frontend con pnpm...
REM pnpm hace unlink en node_modules del proyecto; si U: tiene NTFS roto/archivos ilegibles,
REM hay que borrar esta carpeta ANTES (rd /s /q suele ir mejor que borrar desde el explorador).
if exist "frontend\node_modules" (
    echo Borrando carpeta anterior frontend\node_modules...
    rd /s /q "frontend\node_modules" 2>nul
    timeout /t 1 /nobreak >nul
)
if exist "frontend\node_modules" (
    echo [ERROR] No se pudo borrar "frontend\node_modules".
    echo   Cierra Cursor, VS Code, terminales y cualquier proceso que use esa ruta.
    echo   Si el disco U: esta danado: reinicia el PC, ejecuta "chkdsk U: /f" ^(o copia el repo a C:\^).
    pause
    exit /b 1
)
cd frontend
where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm no esta en PATH. Con Node 16.13+: corepack enable
    echo         Luego: corepack prepare pnpm@10.11.0 --activate
    cd ..
    pause
    exit /b 1
)
REM Store en disco local (C:) para no depender de U:\.pnpm-store ni de U: si el volumen da errores stat/corrupcion.
if not defined PHOTOS_PNPM_STORE set "PHOTOS_PNPM_STORE=%LOCALAPPDATA%\pnpm-store-photosrecognizer"
echo pnpm store-dir: %PHOTOS_PNPM_STORE%
call pnpm install --store-dir "%PHOTOS_PNPM_STORE%"
if errorlevel 1 (
    echo [ERROR] pnpm install fallo.
    echo   Si el mensaje menciona "unlink" en U:\...\node_modules, el volumen U: o esa carpeta
    echo   sigue corrupta: borra manualmente frontend\node_modules o mueve el proyecto a C:\.
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
