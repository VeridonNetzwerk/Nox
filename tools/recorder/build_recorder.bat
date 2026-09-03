@echo off
echo.
echo  Hey Nox Recorder - Build Script (Nuitka --onefile)
echo  ====================================================
echo.

REM Pruefe ob py verfuegbar ist
where py >nul 2>nul
if %errorlevel% neq 0 (
    echo  FEHLER: Python nicht gefunden!
    echo  Bitte Python von https://python.org installieren.
    pause
    exit /b 1
)

echo  [1/3] Installiere Nuitka falls fehlend...
py -m pip install nuitka --quiet 2>nul

echo  [2/3] Installiere Skript-Dependencies...
py -m pip install numpy sounddevice --quiet 2>nul

echo  [3/3] Baue einzelne .exe (kann 5-10 Minuten dauern)...
py -m nuitka ^
    --onefile ^
    --output-dir="%~dp0dist" ^
    --output-filename="HeyNox_Recorder.exe" ^
    --windows-console-mode=force ^
    --company-name="VeridonNetzwerk" ^
    --product-name="Hey Nox Recorder" ^
    --file-version=1.0.0.0 ^
    --product-version=1.0.0.0 ^
    --file-description="Hey Nox Wake-Word Aufnahme-Tool" ^
    --copyright="Copyright (c) 2026 VeridonNetzwerk" ^
    --assume-yes-for-downloads ^
    --remove-output ^
    "%~dp0record_hey_nox.py"

if %errorlevel% neq 0 (
    echo.
    echo  FEHLER: Build fehlgeschlagen!
    pause
    exit /b 1
)

echo.
echo  FERTIG! Die .exe liegt hier:
echo    %~dp0dist\HeyNox_Recorder.exe
echo.
echo  Eine einzelne Datei - einfach an Leute schicken.
echo  Keine Python-Installation noetig.
echo  Windows Defender sollte sie nicht blockieren (Nuitka C-Kompilat).
echo.
pause
