@echo off
title Panel Diego Visuals
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta instalar Node.js en este ordenador.
  echo  Descargalo desde https://nodejs.org - boton verde, version LTS -
  echo  instalalo dandole a Siguiente a todo, y vuelve a abrir este archivo.
  echo  Si te lias, avisa a Alex.
  echo.
  pause
  exit /b 1
)

if not exist "panel\node_modules" (
  echo.
  echo  Primera vez: instalando componentes. Puede tardar unos minutos...
  echo.
  pushd panel
  call npm install --omit=dev --no-audit --no-fund
  popd
)

echo.
echo  Abriendo tu panel en el navegador...
echo.
echo  NO CIERRES esta ventana negra mientras uses el panel.
echo  Cuando termines de editar, cierrala y ya esta.
echo.
start "" http://localhost:4173/admin
cd panel
node server.js
pause
