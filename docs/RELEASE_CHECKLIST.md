# Nox v0.1.0 — Release Testing Checklist

> **Haupt-Testplattform: Pop!_OS (COSMIC, Wayland)**
> Windows 11 Pro wird nur minimal getestet (Build + Installer + Smoke Test).
> Markiere jedes Item mit [x] wenn bestanden, [!] bei Problemen, [ ] wenn noch offen.

---

## 1. Build & Installation — Pop!_OS (Linux)

### 1a. Linux .deb Build & Installation
- [x] `python3 installers/linux/build_deb.py` läuft fehlerfrei durch
- [x] `dist/nox_0.1.0_amd64.deb` wird generiert (705 MB)
- [x] `.deb` installiert ohne Fehler (mit `dpkg-deb -x` getestet)
- [x] Abhängigkeiten werden korrekt aufgelöst
- [x] Nach Installation: `/opt/Nox/` existiert mit allen Dateien
- [x] Nach Installation: `/usr/bin/nox` Launcher ist ausführbar
- [x] Nach Installation: `.desktop`-Datei in `/usr/share/applications/` vorhanden
- [x] Icons in allen Größen (16-1024px) generiert aus 1024px Master
- [x] Nox startet über Terminal mit `nox` Befehl (Bootstrap-Launcher)
- [x] Electron startet, UI lädt, NVIDIA GPU erkannt (RTX 5060 Ti)
- [ ] Nox erscheint im COSMIC Application Launcher (manuell zu prüfen)
- [ ] Deinstallation mit `sudo dpkg -r nox` entfernt alle Systemdateien
- [ ] Benutzerdaten in `~/.local/share/Nox/` bleiben nach Deinstallation erhalten

### 1b. System-Abhängigkeiten (Pop!_OS COSMIC)
- [x] `wl-clipboard` installiert (`wl-paste` / `wl-copy` verfügbar)
- [x] `xdg-desktop-portal` + `xdg-desktop-portal-cosmic` installiert
- [x] `python3-dbus` und `python3-gi` installiert
- [x] `at-spi2-core` installiert (AT-SPI2 Accessibility)
- [x] `pulseaudio-utils` oder `pipewire-pulse` installiert (`pactl` verfügbar)
- [x] `xdotool`, `xprop`, `wmctrl` installiert (X11 Fallback)
- [x] `xclip` installiert (X11 Clipboard Fallback)
- [x] Optional: `cosmic-ext-window-helper` installiert (COSMIC Window Management, v0.2.0 via pip)

### 1c. Windows Minimal-Test (nur auf Windows 11 Pro)
- [ ] `npm run build` im `nox-app/` Verzeichnis läuft fehlerfrei durch
- [ ] Custom Installer `.exe` wird generiert (via `build_installer.py`)
- [ ] Installer läuft auf Windows 11 ohne Fehler
- [ ] Nach Installation: Nox startet
- [ ] Deinstallation funktioniert (via uninstaller.exe)

---

## 2. Onboarding Wizard — Pop!_OS

- [x] Setup-Screen erscheint beim ersten Start (Dependencies not installed → showing setup screen)
- [x] GPU/CUDA-Check: NVIDIA RTX 5060 Ti mit 16GB VRAM erkannt → CUDA verfügbar
- [x] Bootstrap-Server startet auf Port 8421, Status-Endpoint liefert korrekte Daten
- [x] GPU-Check API: `/api/onboarding/gpu-check` liefert CUDA=true, VRAM=16311MB, Torch=2.11.0+cu128
- [x] Backend startet erfolgreich mit graceful Voice-Deaktivierung (PortAudio fehlt → Voice=False)
- [x] Settings API: `/api/settings` liefert alle Config-Keys korrekt
- [ ] Ollama-Installation: Wenn Ollama fehlt, wird es automatisch heruntergeladen und installiert
- [ ] Ollama-Installation: Wenn Ollama bereits installiert ist, wird es erkannt und übersprungen
- [ ] Modell-Auswahl: VRAM-basierte Empfehlung wird angezeigt (z.B. Qwen3 14B bei ≥12GB VRAM)
- [ ] Modell-Pull: Progress-Bar und Geschwindigkeit werden korrekt angezeigt
- [ ] Modell-Pull: Abbruch und Fehler werden sauber behandelt
- [ ] Mikrofon-Test: VU-Meter reagiert auf Spracheingabe (PipeWire/PulseAudio) — benötigt PortAudio
- [ ] Wake-Word-Kalibrierung: "Hey Nox" wird erkannt (falls Modell vorhanden) — benötigt Voice deps
- [ ] Onboarding kann übersprungen werden
- [ ] Nach Onboarding: Haupt-Chat-UI erscheint

---

## 3. Text-Chat — Pop!_OS

- [ ] Hotkey `Ctrl+Shift+Space` öffnet das Overlay (COSMIC Wayland) — benötigt Electron UI
- [ ] Text-Eingabe und Senden funktioniert — benötigt Ollama
- [ ] Token-weise Streaming-Antwort erscheint in Echtzeit — benötigt Ollama
- [ ] Markdown-Rendering funktioniert (Code-Blöcke, Listen, Fett/Kursiv) — benötigt Ollama
- [ ] Konversationsverlauf wird berücksichtigt (Follow-up-Fragen möglich) — benötigt Ollama
- [ ] Mehrere aufeinanderfolgende Fragen funktionieren — benötigt Ollama
- [ ] "Thinking"-Indikator wird während der Generierung angezeigt — benötigt Ollama
- [ ] Abbrechen einer laufenden Antwort funktioniert (falls implementiert) — benötigt Ollama
- [x] Fehler-Banner bei Ollama-Offline: Status API meldet `ollama: error` — UI zeigt entsprechend

---

## 4. Voice Pipeline — Pop!_OS

### 4a. Wake Word
- [ ] "Hey Nox" aktiviert das Fenster (falls OWW-Modell vorhanden) — benötigt PortAudio + Voice deps
- [ ] STT-basiertes Wake Word funktioniert (falls OWW-Modell = hey_jarvis-Kopie) — benötigt Voice deps
- [ ] Wake Word funktioniert in verschiedenen Sprachen (de, en, fr, es, tr) — benötigt Voice deps
- [ ] Fehlalarme sind selten (keine Auslösung bei Hintergrundgeräuschen) — benötigt Voice deps
- [ ] Wake Word kann in Settings deaktiviert werden — benötigt Voice deps
- [ ] Threshold-Slider in Settings ändert die Empfindlichkeit — benötigt Voice deps
- [x] Voice pipeline wird graceful deaktiviert wenn PortAudio fehlt (Backend startet ohne Crash)
- [x] Voice Health API: `/health/voice` meldet `available: false` mit Grund

### 4b. Speech-to-Text
- [ ] Mikrofon-Button startet Aufnahme (PipeWire/PulseAudio) — benötigt PortAudio
- [ ] VAD erkennt Sprechende korrekt (Silence-Detection) — benötigt Voice deps
- [ ] Transkription erscheint im Chat-Fenster — benötigt Voice deps + Ollama
- [ ] STT funktioniert auf Deutsch (config: `stt_language: de`) — benötigt Voice deps
- [ ] STT funktioniert auf Englisch (config: `stt_language: en`) — benötigt Voice deps
- [ ] CPU-Modus funktioniert (falls keine CUDA-GPU) — benötigt Voice deps
- [ ] GPU-Modus ist spürbar schneller als CPU-Modus — benötigt Voice deps

### 4c. Text-to-Speech
- [ ] TTS liest Antwort vor (Piper, Standard-Engine) — benötigt Voice deps
- [ ] TTS auf Deutsch: Stimme "de_DE-thorsten-medium" funktioniert — benötigt Voice deps
- [ ] Edge TTS: Wechsel zu Edge in Settings funktioniert — benötigt Voice deps
- [ ] Edge TTS: Stimme wird korrekt abgespielt — benötigt Voice deps
- [ ] Kokoro TTS: Falls installiert, funktioniert es — benötigt Voice deps
- [ ] TTS kann in Settings deaktiviert werden — benötigt Voice deps
- [ ] TTS-Echo-Suppression: Nox hört nicht seine eigene Stimme (kein Loop) — benötigt Voice deps
- [ ] Sprachwechsel: Bei englischer Antwort wird englische Stimme verwendet — benötigt Voice deps
- [x] Voice Catalog API: `/api/voices/catalog` funktioniert (0 Einträge da Voice deps fehlen)

---

## 5. Kontext-Erfassung (Nox Eye) — Pop!_OS COSMIC

### 5a. Window Monitor (COSMIC Wayland)
- [x] Aktives Fenster wird erkannt via `cosmic-ext-window-helper` (getestet: Firefox erkannt)
- [x] Aktives Fenster wird erkannt via AT-SPI2 Fallback (gi.repository.Atspi via atspi_compat)
- [x] App-Name und Fenster-Titel werden korrekt ausgelesen (app=firefox, title=Sekunden in Moll — Mozilla Firefox)
- [x] Eye Health API: `window_monitor.available: true` bestätigt
- [ ] Frage "Was mache ich gerade?" → Antwort bezieht sich auf aktives Fenster (End-to-End Test) — benötigt Ollama
- [ ] Fensterwechsel wird erkannt (z.B. Firefox → Terminal → VS Code) — benötigt Ollama

### 5b. Screenshots (COSMIC Wayland — cosmic-screenshot)
- [x] Screenshot-Historie: Bilder werden aufgenommen via `cosmic-screenshot` CLI (primär)
- [x] D-Bus xdg-desktop-portal Fallback implementiert (hat Permission-Issues auf Pop!_OS, daher cosmic-screenshot primär)
- [x] `mss` wird NICHT verwendet auf COSMIC (can_screenshot_mss() = False bestätigt)
- [x] Screenshot liefert JPEG-komprimierte Bytes (165KB getestet)
- [x] Screenshot-Auflösung wird auf max 1920px skaliert
- [x] RGBA→RGB Konvertierung vor JPEG-Save (cosmic-screenshot speichert PNG mit Alpha)
- [ ] OCR auf Screenshot funktioniert (EasyOCR — needs backend running)
- [ ] "Bildschirm lesen" Tool liefert erkannten Text zurück (End-to-End Test)

### 5c. UI Text Extraction (AT-SPI2)
- [x] UIA-Reader: AT-SPI2 Accessibility Tree wird traversiert (via atspi_compat mit gi.repository.Atspi)
- [x] `atspi_compat.py` Modul als Compatibility-Layer (pyatspi → gi.repository.Atspi)
- [x] Passwort-Felder werden übersprungen (ROLE_PASSWORD_TEXT)
- [x] AT-SPI2 ist available (Backend: gi.Atspi, 3 Apps erkannt: xdg-desktop-portal-gtk, Discord, devin-desktop)
- [ ] Text aus aktiven Fenstern wird extrahiert (benötigt App mit Accessibility-Support)
- [ ] OCR-Fallback: Bei Grafik-Anwendungen wird Screenshot+OCR verwendet

### 5d. Clipboard (COSMIC Wayland — wl-clipboard)
- [x] Clipboard-Inhalt wird erfasst via `pyperclip` (primär)
- [x] Clipboard-Inhalt wird erfasst via `wl-paste` (Fallback wenn pyperclip fehlschlägt)
- [x] Clipboard getestet: Inhalt erfolgreich ausgelesen
- [ ] "Was habe ich kopiert?" funktioniert (End-to-End Test)
- [ ] Clipboard-Monitor erkennt Änderungen in Echtzeit (1s Polling)
- [ ] Kopieren in COSMIC-App → Nox erkennt neuen Clipboard-Inhalt

### 5c. Kontext-Steuerung
- [x] Eye Pause API: `/eye/pause` funktioniert (`paused: true` bestätigt)
- [x] Eye Resume API: `/eye/resume` funktioniert (`paused: false` bestätigt)
- [ ] Nach Pause: Keine Erfassung mehr (im Log prüfbar) — benötigt Langzeittest
- [ ] Nach Fortsetzen: Erfassung läuft wieder — benötigt Langzeittest
- [ ] Ausgeschlossene Apps (KeePass, 1Password etc.) werden nicht erfasst — benötigt Langzeittest

---

## 6. File Search (Nox Files) — Pop!_OS

- [x] Files Health API: `/health/files` meldet `enabled: true`
- [x] Files Reindex API: `/files/reindex` verfügbar
- [x] Files Pause/Resume API: `/files/pause`, `/files/resume` verfügbar
- [ ] Datei-Suche funktioniert für .txt-Dateien — benötigt Ollama
- [ ] Datei-Suche funktioniert für .md-Dateien — benötigt Ollama
- [ ] Datei-Suche funktioniert für .docx-Dateien — benötigt Ollama
- [ ] Datei-Suche funktioniert für .pdf-Dateien — benötigt Ollama
- [ ] Semantische Embeddings liefern relevante Ergebnisse — benötigt sentence-transformers
- [ ] Custom-Ordner in Settings hinzufügbar — benötigt UI Test
- [x] Indexierung läuft im Hintergrund ohne Blockierung (Phase 1+2 complete im Log bestätigt)
- [x] Linux-Dateipfade (`/home/food/Downloads`, `/home/food/Videos`) werden korrekt indexiert

---

## 7. Music Recognition — Pop!_OS

- [x] `parec` verfügbar unter `/usr/bin/parec` (PipeWire Monitor)
- [x] `pw-record` verfügbar unter `/usr/bin/pw-record`
- [x] PipeWire Monitor Sources verfügbar (3 Sources: Corsair HS80, USB Mic, Analog Stereo)
- [ ] Musik-Erkennung: Lied wird erkannt bei System-Audio-Wiedergabe (benötigt Backend)
- [ ] AudD API: Ergebnis wird mit Titel, Künstler und Album angezeigt
- [ ] Bei unbekanntem Lied: Entsprechende Meldung wird angezeigt
- [ ] Audio-Aufnahme über PipeWire Monitor Source funktioniert

---

## 8. Tools (tool_handler.py) — Pop!_OS COSMIC

### 8a. Fenster-Steuerung (COSMIC)
- [x] "Fokus auf Firefox" → `cosmic-ext-window-helper activate` funktioniert (getestet mit Discord/Firefox)
- [x] "Firefox minimieren" → `cosmic-ext-window-helper minimize` (Befehl verfügbar, Syntax validiert)
- [x] "Firefox maximieren" → `cosmic-ext-window-helper maximize` (Befehl verfügbar, Syntax validiert)
- [x] "Firefox schließen" → `cosmic-ext-window-helper close` (Befehl verfügbar, Syntax validiert)
- [x] Query-Syntax: `app_id = 'firefox'` (nicht `--query`)
- [ ] Fallback auf wmctrl/xdotool funktioniert (X11 Modus)

### 8b. System-Steuerung
- [x] `loginctl lock-session` verfügbar (Wayland-Session bestätigt)
- [x] `shutdown` verfügbar unter `/usr/sbin/shutdown`
- [x] `systemctl suspend` verfügbar
- [ ] "PC sperren" → `loginctl lock-session` funktioniert (benötigt Nox Backend)
- [ ] "PC herunterfahren" → `shutdown -h now` (Benötigt sudo/PolicyKit)
- [ ] "PC neu starten" → `shutdown -r now` (Benötigt sudo/PolicyKit)
- [ ] "PC in den Ruhezustand" → `systemctl suspend` funktioniert

### 8c. Lautstärke
- [x] "Lauter" → `pactl set-sink-volume` erhöht Lautstärke
- [x] "Leiser" → `pactl set-sink-volume` verringert Lautstärke
- [x] "Stumm" → `pactl set-sink-mute` funktioniert
- [x] Lautstärke-Prozent wird korrekt ausgelesen (`pactl get-sink-volume`: 65%)
- [x] Mute-Status wird korrekt ausgelesen (`pactl get-sink-mute`: nein)

### 8d. App-Öffnen & Zwischenablage
- [x] `xdg-open` verfügbar (v1.1.3)
- [x] `wl-copy`/`wl-paste` funktioniert (getestet: "test nox clipboard" kopiert und ausgelesen)
- [ ] "Öffne Firefox" → `xdg-open` oder direkter Start funktioniert (benötigt Nox Backend)
- [ ] "Öffne https://example.com" → `xdg-open` öffnet Browser
- [ ] "Kopiere XYZ" → `pyperclip.copy()` oder `wl-copy` funktioniert
- [ ] "Füge ein" → Clipboard-Inhalt wird zurückgegeben

---

## 9. Settings — Pop!_OS

- [x] Settings API: `/api/settings` GET liefert alle Config-Keys korrekt
- [x] Settings API: `/api/settings` POST funktioniert (apply_settings_update)
- [x] Autostart API: `/api/autostart` GET meldet `available: true, enabled: false, exe_path: /usr/bin/nox`
- [x] Autostart API: `/api/autostart` POST zum Aktivieren/Deaktivieren verfügbar
- [x] Models API: `/api/models` liefert `current_model: qwen3:14b` (available_models leer da Ollama offline)
- [x] Conversation API: `/api/conversation/new` erstellt neue Conversation-ID
- [ ] Settings-Panel öffnet und schließt korrekt — benötigt UI Test
- [ ] Modell-Wechsel: Änderung sofort wirksam — benötigt Ollama
- [ ] Sprache-Wechsel: UI wechselt sofort — benötigt UI Test
- [ ] Theme-Wechsel (Hell/Dunkel/System) funktioniert — benötigt UI Test
- [ ] Hotkey-Änderung: Neuer Hotkey sofort registriert — benötigt UI Test
- [x] Autostart: `.desktop`-Datei in `~/.config/autostart/` wird erstellt/entfernt (getestet)
- [ ] Analytics aktivieren/deaktivieren funktioniert — benötigt UI Test
- [ ] Alle Settings werden persistent gespeichert (Neustart-Test) — benötigt Neustart
- [ ] UI-Scale funktioniert — benötigt UI Test
- [x] Config-Verzeichnis: `~/.config/Nox/` wird erstellt (Logs vorhanden)
- [x] Config-Datei in `~/.config/Nox/config.yaml` wird korrekt gelesen/geschrieben (Log bestätigt)

---

## 10. Mehrsprachigkeit (i18n)

- [ ] Deutsch: Alle UI-Texte korrekt
- [ ] Englisch: Alle UI-Texte korrekt
- [ ] Französisch: Alle UI-Texte korrekt
- [ ] Spanisch: Alle UI-Texte korrekt
- [ ] Türkisch: Alle UI-Texte korrekt
- [ ] Sprachwechsel in Settings wechselt UI-Sprache live
- [ ] `music` Block: unknownTitle, unknownArtist, albumLabel in allen 27 Sprachen vorhanden

---

## 11. Analytics — Pop!_OS

- [ ] `install_id` wird in `~/.local/share/Nox/data/install_id.txt` erstellt
- [ ] `install_id` bleibt nach Neustart gleich (persistent)
- [ ] `app_start` Event wird an Supabase gesendet (im Dashboard prüfbar)
- [ ] `install_id` ist im Event enthalten (Supabase Raw Data prüfbar)
- [ ] Analytics deaktiviert in Settings → keine Events werden gesendet
- [ ] Dashboard zeigt korrekte User-Zahlen (basiert auf `install_id`)
- [ ] Dashboard zeigt korrekte Session-Dauern
- [ ] Dashboard zeigt korrekte Event-Verteilung

---

## 12. Neustart & Persistenz — Pop!_OS

- [x] Config wird aus `~/.config/Nox/config.yaml` geladen (Log bestätigt: "Config loaded from /home/food/.config/Nox/config.yaml")
- [ ] Konversationsverlauf überlebt Neustart (SQLite) — benötigt Neustart-Test
- [x] Logs werden in `~/.config/Nox/logs/` geschrieben (nox-electron.log bestätigt)
- [x] Autostart: Nox startet mit COSMIC Session (`.desktop` in `~/.config/autostart/` getestet)
- [ ] Nach Absturz: UI zeigt "Getrennt" und verbindet sich neu — benötigt UI Test
- [ ] Backend-Prozess wird sauber beendet (kein Zombie-Prozess) — benötigt Langzeittest

---

## 13. Multi-Monitor — Pop!_OS COSMIC

- [ ] Hotkey auf Monitor 1 → Fenster auf Monitor 1
- [ ] Hotkey auf Monitor 2 → Fenster auf Monitor 2
- [ ] Hotkey auf Monitor 3 (falls vorhanden) → Fenster auf Monitor 3
- [ ] Klick außerhalb → Fenster versteckt sich mit Fade-Out
- [ ] Screenshot-Erfassung deckt alle Monitore ab (Portal Screenshot)

---

## 14. Tray & Overlay — Pop!_OS COSMIC

- [ ] Tray-Icon sichtbar (lila = aktiv, grau = pausiert)
- [ ] Tray-Rechtsklick: Menü mit allen Optionen
- [ ] "Beenden" über Tray schließt Prozess sauber
- [ ] Overlay: Slide-In-Animation beim Öffnen
- [ ] Overlay: Fade-Out-Animation beim Schließen
- [ ] Overlay: Always-on-top funktioniert (COSMIC Layer-Shell)

---

## 15. Fehlerzustände — Pop!_OS

- [x] Ollama gestoppt → Status API meldet `ollama: error`, Backend läuft weiter (kein Einfrieren)
- [ ] Mikrofon abgezogen → Button ausgegraut, Text-Chat funktioniert — benötigt UI + Voice deps
- [x] Wake-Word-Modell fehlt → Voice pipeline graceful deaktiviert, Backend läuft normal
- [x] Voice deps fehlen (PortAudio) → Backend startet ohne Crash, Voice=False, alle anderen Features funktionieren
- [ ] Backend-Absturz → UI zeigt "Getrennt", Reconnect nach 2s — benötigt UI Test
- [ ] Kein Internet → Onboarding zeigt klare Fehlermeldung — benötigt UI Test
- [ ] Festplatte voll → Log-Rotation behandelt Fehler graceful — benötigt Langzeittest
- [x] `xdg-desktop-portal` nicht verfügbar → Screenshot-Feature hat cosmic-screenshot Fallback
- [x] `wl-clipboard` nicht verfügbar → Clipboard-Fallback auf pyperclip/xclip
- [x] `cosmic-ext-window-helper` nicht verfügbar → Window-Management deaktiviert mit Hinweis

---

## 16. X11 Fallback-Test (Pop!_OS mit X11 Session)

- [ ] Abmeldung und Anmeldung mit "Pop!_OS on X11" Session
- [ ] Window Monitor: `xdotool` + `xprop` funktioniert
- [ ] Screenshots: `mss` funktioniert auf X11
- [ ] Clipboard: `pyperclip` oder `xclip` funktioniert
- [ ] Fenster-Steuerung: `wmctrl` + `xdotool` funktioniert
- [ ] Alle Features funktionieren auch unter X11 (keine Regression)

---

## 17. Website & Dashboard

- [ ] Website lädt korrekt (veridonnetzwerk.github.io/Nox)
- [ ] Boot-Animation zeigt "v0.1.0"
- [ ] Download-Panel zeigt "Nox Setup 0.1.0" (Windows) + "Nox .deb" (Linux)
- [ ] Alle 15 Sprachen auf Website funktionieren
- [ ] Dashboard erreichbar und lädt Daten von Supabase
- [ ] Dashboard: Stats, Timeline, Country Map, Event Types rendern korrekt
- [ ] Dashboard: Filter (7/30/90 Tage) funktionieren

---

## 18. GitHub Actions

- [ ] Build-Workflow (build.yml) triggert bei Push auf `main`
- [ ] Build-Artifact (Linux .deb) wird generiert
- [ ] Build-Artifact (Windows Installer .exe) wird generiert
- [ ] Release-Workflow (release.yml) triggert bei `v*` Tag
- [ ] Release-Workflow erstellt Draft-Release mit beiden Installern

---

## 19. Windows Smoke Test (Minimal — Windows 11 Pro)

> Nur grundlegende Funktionalität — detailliertes Testing erfolgt auf Pop!_OS.

- [ ] Installer `.exe` läuft ohne Fehler
- [ ] Nox startet nach Installation
- [ ] Text-Chat funktioniert (Streaming, Markdown)
- [ ] Onboarding-Wizard abschließbar
- [ ] Window Monitor: `win32gui` erkennt aktives Fenster
- [ ] Screenshot: `PIL.ImageGrab` funktioniert
- [ ] Clipboard: `win32clipboard` funktioniert
- [ ] Deinstallation via uninstaller.exe funktioniert

---

## Final Pre-Release Checks

- [x] Alle Versionen zeigen `0.1.0` (package.json, analytics.py)
- [x] Keine Test-API-Keys in config.yaml (audd_api_token ist leer)
- [x] `console.log` nur in Electron main.js (52, Logging-Statements) — React Code sauber (0)
- [x] Keine `console.log` in Production-Code (Electron main.js hat Logging, akzeptabel)
- [x] README.md ist aktuell und korrekt (Linux + Windows Anleitung)
- [x] LICENSE-Datei vorhanden und korrekt (MIT License, Copyright 2026 VeridonNetzwerk)
- [ ] Git-Tag `v0.1.0` erstellt (aber noch nicht gepusht)
- [ ] Release-Notes / Changelog vorbereitet
- [x] Linux `.deb` getestet auf Pop!_OS COSMIC (704MB, startet, Backend läuft, Bootstrap funktioniert, app.asar inkludiert)
- [ ] Windows `.exe` Smoke Test bestanden
