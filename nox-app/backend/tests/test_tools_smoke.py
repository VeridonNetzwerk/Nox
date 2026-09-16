"""Smoke tests for all Nox tool handlers.

Runs every registered tool with safe arguments and reports the result.
Dangerous tools (nox_beenden, fenster_schliessen, website_oeffnen) are only
exercised via error paths — they are never actually executed.

Usage: python tools_smoke_test.py
"""
import sys
import time
import traceback
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
for _sub in ("core", "voice", "eye", "files", "llm", "analytics", "system"):
    _p = BACKEND_DIR / _sub
    if _p.is_dir() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import logging  # noqa: E402
logging.disable(logging.CRITICAL)

from settings_manager import SettingsManager  # noqa: E402
from eye import EyeManager
from files import FilesManager
from orchestrator.tool_handler import ToolHandler

settings_mgr = SettingsManager()
config = settings_mgr.load()
eye_manager = EyeManager(config)
files_manager = FilesManager(config)


def _noop_broadcast(msg):
    pass


th = ToolHandler(
    eye_manager=eye_manager,
    files_manager=files_manager,
    settings_manager=settings_mgr,
    apply_settings_fn=lambda updates: config.update(updates),
    config=config,
    broadcast=_noop_broadcast,
)

registered = sorted(th._tools.keys())
print(f"Registered tools ({len(registered)}): {', '.join(registered)}")
print("=" * 78)

results = []


def run(name, args, label=""):
    display = label or name
    t0 = time.time()
    try:
        r = th.execute(name, args)
        dt = time.time() - t0
        short = " ".join(str(r).split())[:160]
        flag = "FAIL" if short.startswith(("Fehler:", "Fehler bei", "Fehler beim", "Wetterabfrage fehlgeschlagen")) else "ok"
        results.append((name, flag, f"{dt:.1f}s", short))
    except Exception as exc:
        results.append((name, "CRASH", f"{time.time() - t0:.1f}s", f"{type(exc).__name__}: {exc}"))
    print(f"[{results[-1][1]:>8}] {display:<32} {results[-1][2]:>6}  {results[-1][3]}", flush=True)


# ── Safe, read-only tools ────────────────────────────────────────────────
run("aktuelle_uhrzeit", {})
run("einstellungen_lesen", {})
run("timer_stellen", {"aktion": "liste"})
run("erinnerung_speichern", {"aktion": "liste"})
run("zwischenablage", {"aktion": "einfuegen"})

# ── Local file tools ────────────────────────────────────────────────────
run("datei_lesen", {"pfad": str(BACKEND_DIR / "core" / "main.py"), "suche": "EyeManager"})
run("datei_lesen", {"pfad": "Y:/gibt_es_nicht_xyz.txt"}, label="datei_lesen (fehlt)")
run("dateien_suchen", {"query": "uvicorn"})

# ── Screen tools ────────────────────────────────────────────────────────
run("bildschirm_ansehen", {})
run("screenshot_historie", {})
run("bildschirm_suchen", {"query": "test"})

# ── Settings + profile (write, but with harmless values) ────────────────
current_theme = config.get("ui_theme", "dark")
run("einstellung_aendern", {"key": "ui_theme", "value": current_theme})
run("einstellung_aendern", {"key": "gibts_nicht_xyz", "value": 1}, label="einstellung_aendern (ungueltig)")
current_units = th._user_profile.get("units") or "metric"
run("profil_speichern", {"feld": "units", "wert": current_units})
run("notiz_speichern", {"text": "[TOOLTEST] temporäre Testnotiz"})

# ── Clipboard error path ────────────────────────────────────────────────
run("zwischenablage", {"aktion": "ungueltig"}, label="zwischenablage (unbekannte Aktion)")

# ── Error-path tests for destructive tools (never really executed) ──────
run("system_steuerung", {"aktion": "ungueltig_xyz"}, label="system_steuerung (ungueltig)")
run("app_oeffnen", {"name": "nox_test_app_xyz_12345"}, label="app_oeffnen (fehlt)")
run("fenster_fokus", {"aktion": "wechseln", "name": "nox_test_window_xyz_12345"}, label="fenster_fokus (fehlt)")
run("lautstaerke", {"aktion": "ungueltig_xyz"}, label="lautstaerke (ungueltig)")

# ── Volume: set to 30 and restore (safe round-trip) ─────────────────────
run("lautstaerke", {"aktion": "setzen", "wert": 30}, label="lautstaerke (setzen 30)")
run("lautstaerke", {"aktion": "restore"}, label="lautstaerke (restore)")

# ── Online tools ────────────────────────────────────────────────────────
run("wetter_abfragen", {"ort": "Berlin", "tage": 1})
run("search_web", {"query": "Python Programmiersprache"})
run("uebersetzen", {"text": "Hallo Welt", "zielsprache": "en"})
run("einheit_rechnen", {"aktion": "einheit", "wert": 5, "von": "km", "nach": "meilen"}, label="einheit_rechnen (km->mi)")
run("einheit_rechnen", {"aktion": "waehrung", "wert": 100, "von": "EUR", "nach": "USD"}, label="einheit_rechnen (EUR->USD)")
run("musik_erkennen", {})
run("bild_generieren", {"prompt": "a small red test cube on white background", "stil": "digital_art", "groesse": "quadrat"})

# ── Registration-only checks (destructive — never executed) ──────────────
for t in ("fenster_schliessen", "nox_beenden", "website_oeffnen"):
    ok = th.has_tool(t)
    results.append((t, "SKIP" if ok else "FAIL", "-", "nur Registrierung geprüft (destruktiv)"))
    print(f"[    SKIP] {t:<22} {'-' if ok else 'FEHLT':>6}  nur Registrierung geprüft (destruktiv)", flush=True)

print("=" * 78)
fails = [r for r in results if r[1] in ("CRASH", "FAIL")]
print(f"Ergebnis: {len(results)} Tests | CRASH: {sum(1 for r in results if r[1] == 'CRASH')} | "
      f"FAIL: {sum(1 for r in results if r[1] == 'FAIL')} | SKIP: {sum(1 for r in results if r[1] == 'SKIP')}")
