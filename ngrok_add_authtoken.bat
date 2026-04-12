@echo off
setlocal
cd /d "%~dp0"
title ngrok authtoken

echo.
echo ========================================================================
echo  ngrok needs a free account and authtoken (ERR_NGROK_4018 if missing)
echo ========================================================================
echo.
echo  1) Sign up: https://dashboard.ngrok.com/signup
echo  2) Copy token: https://dashboard.ngrok.com/get-started/your-authtoken
echo  3) Paste below and press Enter
echo.
set /p "NGROK_AUTHTOKEN=Authtoken: "
if not defined NGROK_AUTHTOKEN (
  echo.
  echo Cancelled. Run manually: ngrok config add-authtoken YOUR_TOKEN
  pause
  exit /b 1
)
echo.
ngrok config add-authtoken "%NGROK_AUTHTOKEN%"
echo.
if errorlevel 1 (
  echo Failed. Try: ngrok config add-authtoken YOUR_TOKEN
) else (
  echo OK. Now run start_ngrok_share.bat
)
echo.
pause
endlocal
