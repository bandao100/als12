@echo off
REM Essai local sous Windows (SQLite, paiements simulés). Ne pas utiliser en production.
cd /d %~dp0
if not exist .venv python -m venv .venv
call .venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
set FLASK_APP=wsgi.py
set PAYMENT_SIMULATION=1
flask bootstrap
echo.
echo Ouvrez http://127.0.0.1:5000 dans votre navigateur.
python wsgi.py
pause
