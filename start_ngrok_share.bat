@echo off
setlocal
cd /d "%~dp0"
title ngrok PhotosRecognizer

echo.
echo ========================================================================
echo  FREE plan: 1 ngrok agent. Close any other ngrok window first.
echo  Tunnels: photos_web = Vite 5892, photos_api = FastAPI 8732
echo  Edit ngrok_photos.yml to change ports.
echo.
echo  Antes: start.bat (app en marcha). Luego este .bat solo si queres enlaces publicos ngrok.
echo ========================================================================
echo.

if not exist "%~dp0ngrok_photos.yml" (
  echo ERROR: ngrok_photos.yml missing in this folder.
  pause
  exit /b 1
)

set "USER_CFG=%LOCALAPPDATA%\ngrok\ngrok.yml"
if exist "%USER_CFG%" (
  echo Using authtoken from: %USER_CFG%
  start "ngrok PhotosRecognizer" cmd /k ngrok start --config "%USER_CFG%" --config "%~dp0ngrok_photos.yml" photos_web photos_api
) else (
  echo WARNING: %USER_CFG% not found. Run ngrok_add_authtoken.bat first.
  start "ngrok PhotosRecognizer" cmd /k ngrok start --config "%~dp0ngrok_photos.yml" photos_web photos_api
)

echo.
echo In that window you should see two https URLs.
echo.
echo Next steps - share links:
echo   [1] frontend/.env  VITE_API_URL=https://URL-of-photos_api-tunnel
echo   [2] Restart npm run dev
echo   [3] API .env  CORS_EXTRA_ORIGINS=https://URL-of-photos_web-tunnel
echo   [4] Restart start.bat
echo.
pause
endlocal
