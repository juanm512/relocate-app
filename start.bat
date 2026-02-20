@echo off
echo ==========================================
echo   RELOCATE - Mapa de Alcance CABA
echo ==========================================
echo.

:: Verificar si existe el entorno virtual
if not exist venv\Scripts\python.exe (
    echo Creando entorno virtual...
    python -m venv venv
    echo Instalando dependencias...
    venv\Scripts\pip install -r requirements.txt
)

:: Verificar si existe .env
if not exist .env (
    echo Creando archivo de configuracion...
    copy .env.example .env
    echo.
    echo ==========================================
    echo IMPORTANTE:
    echo Para obtener isocronas reales, edita el
    archivo .env y agrega tu API key de
    echo OpenRouteService (gratuita en:
    echo https://openrouteservice.org/dev/
    echo ==========================================
    echo.
    timeout /t 5 >nul
)

echo Iniciando servidor...
echo.
echo Abre tu navegador en: http://127.0.0.1:5000
echo.
echo Presiona Ctrl+C para detener el servidor
echo ==========================================
echo.

venv\Scripts\python app.py

pause
