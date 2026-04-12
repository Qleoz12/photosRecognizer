@echo off
REM Alias del script unificado (compatibilidad con guias antiguas).
cd /d "%~dp0"
call "%~dp0photos_db.bat" %*
