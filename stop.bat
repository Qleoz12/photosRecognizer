@echo off
echo Deteniendo PhotosRecognizer...

taskkill /FI "WINDOWTITLE eq API - PhotosRecognizer*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Frontend - PhotosRecognizer*" /T /F >nul 2>&1

echo Listo.
