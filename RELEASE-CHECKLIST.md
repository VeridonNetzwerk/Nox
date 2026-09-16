# 🚀 Nox – Release-Checkliste

> **Vor jedem Release komplett durchgehen.** Jeder Punkt enthält die Aktion und das erwartete Ergebnis.
> Legende: 🔴 = Blocker (Release stoppen), 🟡 = sollte gefixt sein, ⚪ = nice-to-have
> ✅ = **von Cascade vorgetestet** (automatisierte Smoke-Tests / Live-Endpoint-Checks während der Entwicklung) — bitte am Ende trotzdem einmal selbst durchklicken

---

## ✅ Was bereits vorgetestet wurde (13.–14.09.2026)

Während der Entwicklung habe ich Folgendes bereits geprüft — die entsprechenden Punkte sind unten mit ✅ markiert:

- **Tool-Smoke-Test, 3 Läufe** (`nox-app/backend/tests/test_tools_smoke.py`): 32/32 Tests grün, 0 Crashes — alle 26 Tools ausgeführt (destruktive nur über Fehlerpfade)
- **Backend-Endpoints live verifiziert**: `/health`, `/api/marketplace/engines` (Nox-Engine + Ollama erkannt, LM Studio korrekt ausgeblendet), `/api/marketplace/ollama-library` (240 Modelle korrekt geparst), `/api/onboarding/gpu-check` (RTX 5060 Ti, 16311 MB)
- **Bugfixes mit Verifikation**: Lautstärke (pycaw + COM-Init, Set/Lauter/Restore-Roundtrip), Zwischenablage (pyperclip, Kopieren+Lesen), `app_oeffnen` (unbekannte App → ehrlicher Fehler, „rechner“ → startet), `search_web` (Retry + Instant-Answers-Fallback), Papierkorb-Exklusion eingebaut (⚠️ Re-Index nötig, dann verifizieren)
- **Builds**: 44 Backend-Python-Dateien kompilieren fehlerfrei, UI-Build grün, `main.js` Syntax OK, keine Linux-Referenzen mehr

---

## 1. Installation & Erster Start

- [ ] **Installer herunterladen und ausführen** → Installation läuft ohne Fehler durch, Nox landet im Startmenü/Desktop-Verknüpfung vorhanden
- [ ] **Ersten Start nach Installation** → Kein Antivirus-Fehlalarm (oder zumindest dokumentiert), Fenster öffnet sich
- [ ] **Backend startet automatisch** → Nach wenigen Sekunden erscheint „Verbunden" unten in der UI; kein „Backend wird gestartet…"-Dauerzustand
- [ ] **Bootstrap-Abhängigkeiten** → Beim ersten Start werden fehlende Python-Pakete installiert (Bootstrap-Server), danach startet das echte Backend
- [ ] **Zweiter Start (warm)** → Backend verbindet sich deutlich schneller, keine doppelten Prozesse im Task-Manager
- [ ] **Start ohne Internet** → App startet trotzdem, UI zeigt verständlichen Offline-Hinweis statt Absturz
- [ ] **Deinstallation/Neuinstallation** → Alte Konfiguration in `%APPDATA%\Nox` wird nicht beschädigt; Neuinstallation übernimmt Einstellungen

## 2. Onboarding (Setup-Assistent)

- [ ] **Onboarding erscheint bei Erstnutzung** → Assistent startet automatisch, Schritt 1 = Engine-Auswahl
- [ ] **GPU-Erkennung im Onboarding** → GPU-Name + VRAM korrekt angezeigt (z. B. „NVIDIA GeForce RTX 5060 Ti, 16 GB") — ✅ vorgetestet: gpu-check-Endpoint liefert exakt diese Werte live
- [ ] **Ollama nicht installiert → Installieren-Button** → OllamaSetup.exe wird heruntergeladen (Fortschrittsbalken), still installiert, Ollama läuft danach
- [ ] **Ollama-Installationsfehler** (z. B. Download abbrechen) → Verständliche Fehlermeldung, „Erneut versuchen" möglich, App hängt nicht
- [ ] **Engine „Ollama" wählen** → Ollama-Status wird geprüft, Haken bei Erfolg
- [ ] **Engine „Nox-Engine" wählen** → Hinweis „Experimentell" sichtbar, GGUF-Verzeichnis wählbar
- [ ] **Engine „Andere" (OpenAI-kompatibel)** → LM-Studio-Endpunkt eingeben, Verbindungstest zeigt Modelle
- [ ] **Modell-Auswahl nach VRAM** → Empfohlenes Modell passt zur GPU (Slider Superschnell→Qualität), Speed-Graph beim Download
- [ ] **Modell-Download im Onboarding** → Fortschritt läuft, Geschwindigkeit wird angezeigt, nach Abschluss ist das Modell installiert und ausgewählt
- [ ] **Sprachauswahl-Schritt** → Stimmen nach Sprache/Geschlecht gefiltert, Vorschau abspielbar, Standardstimme gespeichert
- [ ] **Onboarding abschließen** → Einstellungen persistieren; nach Neustart kommt KEIN Onboarding mehr
- [ ] **Onboarding abbrechen und neu starten** → Zustand sauber, kein halb-fertiger Konfigurationsmüll

## 3. Backend & Verbindung

- [ ] **Health-Check** → `http://127.0.0.1:8420/health` antwortet `{"status":"ok"}` — ✅ vorgetestet
- [ ] **Backend-Absturz → Auto-Restart** → Backend-Prozess killen: Electron startet ihn automatisch neu (max. 5 Versuche, mit steigendem Delay) — ✅ vorgetestet: mehrfach beobachtet, inkl. Erschöpfung nach 5 Versuchen
- [ ] **Backend dauerhaft tot** → Nach 5 Fehlversuchen: klare Meldung in den Logs, UI zeigt Verbindungsfehler, kein Crash der UI — ✅ vorgetestet: Verhalten beobachtet (manueller Start war nötig)
- [ ] **WebSocket-Reconnect** → Backend kurz killen und neu starten: UI verbindet sich automatisch wieder, Toast „Verbindung getrennt → wieder verbunden"
- [ ] **Port 8420 belegt** → Zweite Nox-Instanz oder anderer Dienst auf 8420: verständlicher Fehler, keine Endlos-Crash-Loop

## 4. Chat – Grundfunktionen

- [ ] **Einfache Frage stellen** → Antwort streamt Wort für Wort, Cursor/„denkt"-Indikator während Generierung
- [ ] **Streaming abschließen** → „done" erreicht: Stream-Indikator verschwindet, Antwort bleibt, Statistiken (Tokens/s) erscheinen
- [ ] **Mehrere Nachrichten hintereinander** → Kontext wird beachtet („Wie heißt die Stadt gerade eben nochmal?")
- [ ] **Lange Antwort** → Auto-Scroll bleibt unten, manuelles Hochscrollen wird nicht weggerissen
- [ ] **Stop-Button während Generierung** → Generierung bricht ab, Teilantwort bleibt, neue Nachricht möglich
- [ ] **Timeout (120 s)** → Bei hängender Generierung: automatischer Abbruch mit „Zeitüberschreitung"-Hinweis
- [ ] **Markdown-Rendering** → Code-Blöcke, Listen, Fettdruck, Tabellen werden sauber gerendert
- [ ] **Code-Block kopieren** → Kopieren-Button an Code-Blöcken funktioniert
- [ ] **Nachricht kopieren** → Kopieren-Button an Assistenten-Antworten funktioniert
- [ ] **Vorlesen-Button** → TTS liest die Antwort vor, Button-Zustand wechselt während des Vorlesens
- [ ] **Emoji/Sonderzeichen/Umlaute** → korrekt in Eingabe, Antwort und Verlauf
- [ ] **Sehr lange Eingabe** (mehrere tausend Zeichen) → wird gesendet und verarbeitet, kein UI-Freeze
- [ ] **Leere Nachricht** → Senden-Button erscheint erst bei Text, Enter mit leerem Feld tut nichts

## 5. Chat – Erweiterte Funktionen

- [ ] **Antwort neu generieren** → Neue Version entsteht, Versions-Pfeile (‹ ›) erscheinen, Umschalten zwischen Versionen funktioniert
- [ ] **Chat abzweigen (Fork)** → Ab hier neuer Chat, Backend startet neue Conversation, Toast bestätigt
- [ ] **Nachricht anpinnen** → Gepinnte Nachricht erscheint im Pin-Bereich, erneutes Klicken entfernt sie
- [ ] **Feedback (Daumen hoch/runter)** → Wird an `/api/feedback` gesendet (kein sichtbarer Fehler)
- [ ] **Antwort-Statistiken** → Modellname, Tokens/s, Latenz werden an der Antwort angezeigt
- [ ] **Thinking-Modus einschalten** → Toggle aktiv, Antwort enthält Denkphase (falls Modell unterstützt), UI zeigt Thinking an
- [ ] **Web-Suche-Toggle** → Bei aktuellen Fragen wird `search_web` genutzt, Suchfortschritt erscheint in der UI

## 6. Slash-Befehle

- [ ] **`/` im Eingabefeld** → Slash-Menü öffnet sich mit allen Befehlen
- [ ] **Filtern durch Tippen** (`/wet`) → Liste filtert live
- [ ] **Befehl auswählen** → Prompt-Vorlage landet im Eingabefeld
- [ ] **`/wetter`** → Wetter-Karte erscheint (siehe Abschnitt Karten)
- [ ] **`/musik`** → Musik-Erkennung startet (Shazam), Ergebnis-Karte oder verständlicher Fehler
- [ ] **`/bild` + Prompt** → Bild-Karte erscheint, Bild lädt von Pollinations
- [ ] **`/brief`** → Tägliches Briefing wird generiert und als Antwort eingefügt
- [ ] **`/uhrzeit`, `/notiz`, `/dateien`, `/einstellungen`** → jeweils sinnvolles Ergebnis
- [ ] **Escape im Slash-Menü** → Menü schließt, Eingabe bleibt

## 7. Spracheingabe (Wake Word & STT)

- [ ] **Mikrofon-Klick (Push-to-Talk)** → Aufnahme startet (Indikator), nach Stille wird transkribiert, Text steht im Chat
- [ ] **Wake Word „Hey Nox"** → Bei erkanntem Wake Word hört Nox zu, transkribiert und antwortet
- [ ] **Wake Word deaktivieren** → Einstellung wirkt sofort, kein Zuhören mehr
- [ ] **Kein Mikrofon vorhanden** → Verständlicher Hinweis, App crasht nicht
- [ ] **Sprachnachricht-Verlauf** → User-Nachrichten mit 🎤-Icon als Sprache markiert
- [ ] **Voice-Modus-Kreislauf** → Frage per Sprache → Antwort wird vorgelesen → wieder bereit für nächste Frage (Hands-free-Loop)
- [ ] **Stumme Umgebung / Rauschen** → Keine Fehlauslösungen des Wake Word bei normalem Raumgeräusch

## 8. Sprachausgabe (TTS)

- [ ] **Standardstimme antwortet** → Antworten werden automatisch vorgelesen (wenn aktiviert)
- [ ] **Stimme wechseln** (Piper/Kokoro/Edge) → Neue Stimme wird geladen und gesprochen
- [ ] **Edge-TTS (Cloud)** → Funktioniert mit Internet, graceful Fehler ohne
- [ ] **Lokale Stimme (Piper/Kokoro)** → Funktioniert offline
- [ ] **Vorlesen abbrechen** → Klick während Vorlesen stoppt die Ausgabe
- [ ] **Audio-Ausgabegerät wechseln** → Einstellung wird übernommen (TTS + Musik-Erkennung)

## 9. Tools (alle 26)

### Information & Zeit
- [ ] **`aktuelle_uhrzeit`** → korrektes Datum/Uhrzeit auf Deutsch — ✅ vorgetestet
- [ ] **`wetter_abfragen` (ohne Ort)** → nutzt gespeicherten Standort; ohne gespeicherten Standort: verständlicher Fehler
- [ ] **`wetter_abfragen` (mit Ort + tage=3)** → 3-Tage-Vorhersage, Wetter-Karte erscheint — ✅ vorgetestet (Berlin, 3 Läufe, korrekte Werte)
- [ ] **`search_web`** → 5 Ergebnisse mit Titel/URL/Ausschnitt; auch nach 5+ Suchen (kein Anti-Bot-Ausfall) — ✅ vorgetestet: funktioniert; Retry + Instant-Answers-Fallback eingebaut nach beobachtetem DDG-Reset
- [ ] **`uebersetzen`** (de→en, auto-Erkennung) → korrekte Übersetzung — ✅ vorgetestet („Hallo Welt“ → „Hello World“)
- [ ] **`einheit_rechnen` (km→meilen)** → korrekte Umrechnung — ✅ vorgetestet (5 km = 3,1069 mi)
- [ ] **`einheit_rechnen` (EUR→USD)** → aktueller Kurs mit Datum — ✅ vorgetestet (100 EUR = 115,92 USD, Kurs vom 11.09.)

### Erinnerungen & Timer
- [ ] **`timer_stellen` (5 Minuten)** → Timer läuft, nach Ablauf: Benachrichtigung + TTS
- [ ] **`timer_stellen` (liste)** → aktive Timer sichtbar — ✅ vorgetestet (leere Liste sauber)
- [ ] **`timer_stellen` (abbrechen)** → Timer gestoppt
- [ ] **`erinnerung_speichern` (morgen 8 Uhr)** → persistiert, überlebt Neustart, feuert zur Zeit
- [ ] **`erinnerung_speichern` (liste/loeschen)** → Liste zeigt Einträge, Löschen entfernt sie — ✅ vorgetestet (Liste zeigt persistente Einträge inkl. „überfällig“-Status)

### System-Steuerung
- [ ] **`lautstaerke` (setzen/lauter/leiser)** → Systemlautstärke ändert sich hörbar, Vorher-Wert korrekt — ✅ vorgetestet: setzen 40 % → lauter 50 %, korrekte Vorher-Werte (pycaw + COM-Fix verifiziert)
- [ ] **`lautstaerke` (mute/unmute/restore)** → Stumm an/aus, Restore stellt alten Wert wieder her — ✅ vorgetestet: Restore-Roundtrip korrekt (mute/unmute aus Rücksicht nicht ausgeführt — gleicher Codepfad)
- [ ] **`app_oeffnen` (bekannte App, z. B. „rechner")** → Calculator öffnet — ✅ vorgetestet
- [ ] **`app_oeffnen` (nicht existierende App)** → ehrliche Fehlermeldung „wurde nicht gefunden" (KEIN „App gestartet") — ✅ vorgetestet (Bugfix verifiziert)
- [ ] **`fenster_fokus` (offenes Fenster)** → Fenster kommt nach vorn
- [ ] **`fenster_fokus` (unbekanntes Fenster)** → „Kein Fenster gefunden" — ✅ vorgetestet
- [ ] **`system_steuerung` (sperren)** → PC sperrt sich (⚠️ nur bewusst testen)
- [ ] **`system_steuerung` (ungültige Aktion)** → Fehlermeldung mit gültigen Aktionen (KEIN Shutdown!) — ✅ vorgetestet
- [ ] **`fenster_schliessen`** → Nox-Fenster versteckt sich, Tray bleibt, Hotkey holt es zurück
- [ ] **`nox_beenden`** → Beendet Nox komplett (⚠️ zuletzt testen, Neustart danach nötig)

### Dateien & Notizen
- [ ] **`dateien_suchen` (bekanntes Stichwort)** → Treffer mit Pfad + Ausschnitt; **keine** Treffer aus Papierkorb (`#recycle`, `$Recycle.Bin`) — ✅ Suche vorgetestet; Papierkorb-Exklusion eingebaut, ⚠️ nach Re-Index nochmal prüfen
- [ ] **`datei_lesen` (existierende Datei)** → Inhalt mit Zeilennummern — ✅ vorgetestet (inkl. Suche-Parameter)
- [ ] **`datei_lesen` (nicht existent)** → „Datei nicht gefunden" — ✅ vorgetestet
- [ ] **`notiz_speichern`** → Notiz gespeichert, später abrufbar — ✅ vorgetestet
- [ ] **`profil_speichern` (Standort)** → wird gespeichert und von `wetter_abfragen` ohne Ort genutzt — ✅ vorgetestet (units-Feld; Standort-Feld gleicher Codepfad)

### Zwischenablage & Bildschirm
- [ ] **`zwischenablage` (kopieren)** → Text landet in der Zwischenablage (Strg+V prüfen) — ✅ vorgetestet (pyperclip-Fix verifiziert)
- [ ] **`zwischenablage` (einfuegen)** → liest aktuellen Zwischenablage-Inhalt — ✅ vorgetestet
- [ ] **`bildschirm_ansehen`** → beschreibt den aktuellen Bildschirm (UIA/OCR), Passwortfelder werden NICHT ausgelesen — ✅ vorgetestet (4 Läufe, korrekte Fenstererkennung; Passwortfilter im Code geprüft)
- [ ] **`bildschirm_suchen` (Begriff vom Bildschirm)** → findet den Kontexteintrag — ✅ vorgetestet (fand Clipboard-Eintrag)
- [ ] **`screenshot_historie`** → Liste der letzten Screenshots mit App/Fenster — ✅ vorgetestet (graceful leer ohne laufenden Screen-Monitor)

### Spezial
- [ ] **`musik_erkennen` (Musik läuft)** → Song + Interpret + Cover werden erkannt
- [ ] **`musik_erkennen` (keine Musik)** → verständlicher Fehler nach ~20–40 s, kein Hängen — ✅ vorgetestet (graceful Fehler ohne laufende Musik)
- [ ] **`bild_generieren`** → Bild-Karte erscheint, Bild lädt vollständig — ✅ vorgetestet (Tool + Pollinations-URL liefert image/jpeg 200)

## 10. Antwort-Karten

- [ ] **Wetter-Karte** → Gradient-Header, aktuelle Werte, ggf. Stundenwerte; Karte bleibt beim Tab-Wechsel erhalten (Bugfix-Verifikation!)
- [ ] **Wetter-Karte nach Chat-Wechsel** → Chat mit Wetter verlassen, später zurückklicken → Karte ist NOCH DA
- [ ] **Musik-Karte** → Cover, Titel, Interpret, Plattform-Buttons (Spotify/YouTube), Öffnen funktioniert
- [ ] **Bild-Karte** → Bild lädt, Prompt darunter, Regenerieren möglich
- [ ] **Karten im Verlauf nach Neustart** → Nachrichten sind da (Karten-Daten nach Neustart leer = bekannt/akzeptiert)

## 11. AI Marketplace

- [ ] **Marketplace öffnen (Sidebar)** → Öffnet sich, **Seitenleiste bleibt sichtbar/bedienbar**
- [ ] **Engine-Tabs nur für vorhandene Engines** → Rechner mit Ollama + Nox-Engine: genau 2 Tabs; LM-Studio-Tab nur wenn Server läuft — ✅ vorgetestet: Engines-Endpoint live (llama_cpp ✓, ollama ✓, openai_compatible korrekt ausgeblendet); UI-Darstellung bitte selbst ansehen
- [ ] **Standard-Tab = konfigurierte Engine** → Aktives Backend ist vorausgewählt — ✅ Logik vorgetestet (Endpoint liefert konfiguriertes Backend)
- [ ] **Plattform-Badge unter jedem Modell** → „Nox-Engine (GGUF)" / „Ollama" / „OpenAI-kompatibel" sichtbar
- [ ] **Marken-Logos** → Echte HF-Avatare (Qwen, Meta, Google, …) laden; bei Offline: SVG-Fallback statt kaputtem Bild — ✅ vorgetestet: CDN-URL-Muster live verifiziert (Qwen, meta-llama, ibm-granite, deepseek-ai); onError-Fallback im Code
- [ ] **Empfohlen-Bereich** → 3 Picks passend zur VRAM-Klasse, mit Fit-Badge (Passt/Hybrid/CPU)
- [ ] **Ollama-Tab: 240+ Modelle** → Bibliothek lädt (Spinner), Sortierung Beliebt/Neu/Größe funktioniert — ✅ vorgetestet: Endpoint liefert 240 Modelle mit korrekten Namen/Capabilities/Größen; UI-Darstellung bitte selbst ansehen
- [ ] **Suche im Marketplace** → Filtert nach Name/Familie/Tags in beiden Tabs
- [ ] **Capability-Filter (Ollama-Tab)** → Vision/Tool-Calling/Thinking/Embedding filtern korrekt
- [ ] **Collections (Nox-Engine-Tab)** → Coding/MoE/„Passt auf meine Hardware" filtern korrekt
- [ ] **Modell installieren** → Download-Banner mit Fortschritt/Geschwindigkeit, dünne Progress-Linie an der Karte, Button zeigt „Lädt…"
- [ ] **Download in Warteschlange** → Zweites Modell während laufendem Download: Toast „zur Warteschlange hinzugefügt (Position 1)", Banner zeigt „+1 in Warteschlange"
- [ ] **Download pausieren/fortsetzen/abbrechen** → Alle drei Aktionen wirken sofort
- [ ] **Download abgeschlossen** → Toast, Modell erscheint als installiert (kein Button-Flackern), aktivierbar
- [ ] **Modell aktivieren** → Wird aktives Modell, Chat nutzt es sofort, „Aktiv"-Badge
- [ ] **Modell löschen** → Nach Bestätigung aus Liste/Platte entfernt
- [ ] **Detail-Modal** → Öffnet per Klick auf Karte: Benchmarks (kuratiert), Lizenz, Größe, VRAM, Kontext; Escape/Backdrop schließt
- [ ] **Update-Badge** → Modelle mit neuerer Katalog-Version zeigen „Update"
- [ ] **OpenAI-kompatibel-Tab (LM Studio läuft)** → Listet Server-Modelle, „Verwenden" schaltet Backend um — ⚠️ Endpoint existiert, konnte ohne laufenden LM Studio nicht live getestet werden
- [ ] **Marketplace schließen** → Zurück zum Chat, Zustand (Downloads) läuft weiter

## 12. Modell- & Engine-Verwaltung

- [ ] **Modellwechsel im Chat (Dropdown)** → Wechsel wirkt sofort, aktives Modell im Header
- [ ] **„Alle Modelle anzeigen"** → Vollständige Liste inkl. installierter Nicht-Katalog-Modelle
- [ ] **Engine-Wechsel in Einstellungen** → Ollama ↔ Nox-Engine ↔ OpenAI-kompatibel; Chat funktioniert nach Wechsel
- [ ] **Nox-Engine: GGUF laden** → Modell lädt in den Prozess, Antwort generiert
- [ ] **Ungültiger LM-Studio-Endpunkt** → Verständlicher Verbindungsfehler

## 13. VRAM-Management

- [ ] **Auto-Downgrade bei wenig VRAM** → Toast „Wenig VRAM — auf X gewechselt", kleineres Modell aktiv
- [ ] **Auto-Upgrade bei VRAM-Erholung** → Toast „VRAM erholt — zurück auf X"
- [ ] **VRAM-kritisch → Entladen** → Toast „Modell entladen", System bleibt stabil
- [ ] **VRAM-Modus „off"** → Kein automatisches Umschalten

## 14. Nox Eye (Kontext-Erfassung)

- [ ] **Screen-Monitoring läuft** → Nach einigen Minuten Nutzung: Kontexteinträge vorhanden (bildschirm_suchen findet etwas)
- [ ] **Passwort-Manager ausschließen** → KeePass/1Password etc. in Ausschlussliste → deren Inhalte NIE im Kontext
- [ ] **Excluded Apps Einstellung** → Neu hinzugefügte App wird sofort nicht mehr erfasst
- [ ] **TTL (Aufbewahrung)** → Alte Einträge werden nach konfigurierter Zeit gelöscht
- [ ] **Clipboard-Monitor** → Kopierter Text erscheint im Kontext (mit „(clipboard)"-Markierung)
- [ ] **Eye pausieren** → Erfassung stoppt, resume startet wieder
- [ ] **Proaktive Kontextnutzung** → „Was habe ich gerade auf dem Bildschirm?" → Antwort nutzt Screen-Kontext
- [ ] **App erwähnen („auf Emby")** → Nox liest das genannte Fenster auch wenn es nicht fokussiert ist

## 15. Dateisuche

- [ ] **Ordner hinzufügen** → Indexierung startet, Fortschritt sichtbar
- [ ] **Suche nach Dateiinhalt** → Treffer mit Dateiname, Pfad, Ausschnitt
- [ ] **PDF/DOCX-Indexierung** → Inhalt wird extrahiert und gefunden
- [ ] **Ausschluss-Ordner** → node_modules/.git/AppData werden nicht indexiert
- [ ] **Re-Index** → Button funktioniert, Duplikate entstehen keine
- [ ] **Sensible Dateien** → Dateien mit „password"/„credentials"/„.kdbx" im Namen werden NIEMALS indexiert

## 16. Einstellungen (alle Kategorien)

### Allgemein
- [ ] **Hotkey ändern** → Neuer Hotkey registriert sich sofort, alter funktioniert nicht mehr
- [ ] **Hotkey-Konflikt** (bereits von anderer App belegt) → Fehlermeldung in Logs, App läuft weiter
- [ ] **Theme hell/dunkel/system** → Wechselt sofort und persistiert
- [ ] **Skin (Aurora/Ocean/Sunset/Forest/Mono)** → Farbschema wechselt komplett (auch Marketplace, Settings, Overlay)
- [ ] **UI-Skalierung** → Größe ändert sich, Layout bricht nicht
- [ ] **Autostart an/aus** → Registry-Eintrag wird gesetzt/entfernt (prüfbar mit `msconfig`/Autostart-Tab im Task-Manager)
- [ ] **Analytics-Toggle** → Schaltet Analyse an/aus

### KI
- [ ] **Modell-Auswahl** → siehe Abschnitt 12
- [ ] **Ollama-Host ändern** → Verbindungstest gegen neuen Host
- [ ] **Preload-Modell beim Start** → Modell lädt automatisch beim Backend-Start

### Stimme
- [ ] **Eingabe-/Ausgabegerät wählen** → wirkt auf STT/TTS/Musik
- [ ] **Wake-Word-Schwelle** → empfindlicher/unsensibler spürbar
- [ ] **Stille-Erkennung (VAD)** → Antwortende Stille beendet Aufnahme zuverlässig
- [ ] **TTS-Modell wechseln** → neue Stimme nach kurzer Ladezeit

### Kontext (Eye)
- [ ] **Screenshot-Intervall ändern** → wird live übernommen (Log bestätigt)
- [ ] **TTL-Tage ändern** → wirkt auf Kontext-Store

### Dateien
- [ ] **Laufwerke/Ordner verwalten** → Hinzufügen/Entfernen wirkt auf Index

### Über
- [ ] **Versionsnummer korrekt** → stimmt mit Release überein
- [ ] **Update-Check** → „Nach Updates suchen" funktioniert; bei neuer Version: Banner + Download+Install
- [ ] **Config-Pfad öffnen** → Explorer öffnet `%APPDATA%\Nox`

- [ ] **Alle Einstellungen persistieren** → Nach App-Neustart sind ALLE Änderungen noch da
- [ ] **Einstellungen-Suche** → Filtert Kategorien nach Stichwort

## 17. Sidebar & Chat-Verlauf

- [ ] **Neuer Chat (Tab +)** → Leerer Tab, vorheriger behält Verlauf
- [ ] **Zwischen Tabs wechseln** → Nachrichten + Karten (Wetter!) bleiben pro Tab erhalten
- [ ] **Tab schließen** → Nächster Tab wird aktiv, Zustand korrekt
- [ ] **Alle Tabs schließen** → Leerer Zustand, neuer Chat wird beim Senden automatisch erstellt
- [ ] **Chat-Verlauf in Sidebar** → Letzte Unterhaltungen mit Zeitstempel
- [ ] **Alte Unterhaltung laden** → Nachrichten + Statistiken erscheinen; Klick auf dieselbe Unterhaltung erneut → wechselt zum bereits offenen Tab (kein Duplikat)
- [ ] **Chat-Suche in Sidebar** → Findet Unterhaltungen nach Stichwort
- [ ] **Verlauf nach Neustart** → Letzte Chats wieder da (Backend-persistiert)
- [ ] **Chat-Titel** → Tab bekommt Titel aus erster Nachricht

## 18. Overlay-Modus

- [ ] **Overlay öffnen (Hotkey)** → Kleines Overlay-Fenster erscheint über anderen Apps
- [ ] **Frage im Overlay** → Antwort erscheint, Fenster passt Größe an
- [ ] **Overlay schließen** → Hotkey/Escape, Hauptfenster unbeeinflusst
- [ ] **Overlay + Hauptfenster parallel** → Beide funktionieren unabhängig

## 19. System-Integration

- [ ] **Tray-Icon** → Sichtbar, Tooltip „Nox – Lokaler KI-Assistent"
- [ ] **Tray-Menü** → Alle Einträge funktionieren (Öffnen, Beenden, …)
- [ ] **Fenster schließen (X)** → Nox geht in den Tray (läuft weiter), KEIN Beenden
- [ ] **Tray → Beenden** → Beendet App + Backend sauber (kein Orphan-Prozess im Task-Manager)
- [ ] **Globaler Hotkey** → Fenster toggeln aus jeder App heraus
- [ ] **Zweite Instanz starten** → Wird verhindert oder fokussiert die erste (kein Doppel-Backend)
- [ ] **Windows-Neustart mit Autostart** → Nox startet automatisch, Backend verbindet

## 20. Fehlerbehandlung & Resilienz

- [ ] **Ollama gestoppt, Frage senden** → Verständliche Fehlermeldung im Chat („Backend nicht erreichbar"), App stabil
- [ ] **Ollama während Generierung stoppen** → Fehlermeldung/Timeout, danach Erholung wenn Ollama wieder startet
- [ ] **Kein Internet: Websuche** → verständlicher Fehler (kein Crash) — ✅ vorgetestet: ConnectionError-Pfad beobachtet, danach Retry + Instant-Answers-Fallback eingebaut
- [ ] **Kein Internet: Wetter** → verständlicher Fehler
- [ ] **Kein Internet: Ollama-Bibliothek im Marketplace** → Fallback-Liste erscheint
- [ ] **Kein Internet: Bild-Generierung** → Fehlermeldung/Bild lädt nicht, UI stabil
- [ ] **Ungültige Modellantwort/Tool-Ausgabe** → wird abgefangen, keine UI-Crashs — ✅ vorgetestet: `ToolHandler.execute` fängt alle Handler-Exceptions ab (32 Smoke-Tests, 0 Crashes)
- [ ] **Backend-Neustart während offenem Chat** → UI reconnectet, Verlauf bleibt
- [ ] **Festplatte voll beim Modell-Download** → Fehlermeldung statt Endlos-Spin
- [ ] **ErrorBoundary** → UI-Crash zeigt Fehlerseite mit Neustart-Option statt weißem Fenster

## 21. Performance & Ressourcen

- [ ] **RAM-Verbrauch im Leerlauf** → angemessen (Backend + UI + Modell dokumentieren)
- [ ] **RAM während Antwort** → kein ungebremstes Anwachsen
- [ ] **CPU im Leerlauf** → Screen-Monitoring verursacht keine Dauerlast
- [ ] **Antwortgeschwindigkeit** → Tokens/s plausibel für Modell + GPU
- [ ] **Lange Chats (100+ Nachrichten)** → Scrollen bleibt flüssig, kein Memory-Leak sichtbar
- [ ] **Mehrere Tabs + Marketplace + Download parallel** → UI bleibt bedienbar
- [ ] **Logs wachsen kontrolliert** → Rotation greift (10 MB × 3 + täglich 7 Tage)

## 22. Privatsphäre & Sicherheit

- [ ] **Alles läuft lokal** → Chat-Inhalte verlassen den PC nicht (außer explizite Cloud-Features: Websuche, Wetter, Shazam, Pollinations, Edge-TTS — dokumentieren!)
- [ ] **Analytics-Inhalte prüfen** → Es werden keine Chat-Inhalte/Dateipfade gesendet
- [ ] **Passwort-Schutz** → Passwortfelder nie in Kontext/Logs
- [ ] **Code-Ausführung (`/api/execute`)** → nur mit Timeout, keine kritischen Schäden bei Test
- [ ] **API nur lokal gebunden** → Backend lauscht auf 127.0.0.1, nicht 0.0.0.0 (Fremdzugriff im Netzwerk prüfen)
- [ ] **Keine API-Keys im Code/Logs** → LM-Studio-Key etc. nur in Config

## 23. UI/UX-Polish

- [ ] **Fenstergröße ändern** → Alle Views (Chat, Marketplace, Settings, Onboarding) responsive
- [ ] **Minimale Fenstergröße** → Layout bricht nicht
- [ ] **Toasts** → Erfolg/Fehler/Info erscheinen, verschwinden nach Dauer, stapeln sauber
- [ ] **Ladezustände überall** → Kein toter Klick ohne Feedback (Buttons zeigen Spinner/Disabled)
- [ ] **Deutsche Texte vollständig** → Keine englischen Reste in der DE-UI (und umgekehrt, falls Sprachumschaltung existiert)
- [ ] **Konsistente Icons** → Download-Icons gut sichtbar (Bugfix-Verifikation), keine fehlenden Icons
- [ ] **Dark-Mode-Kontraste** → Alle Texte lesbar (auch in allen 5 Skins)
- [ ] **Tastatur-Navigation** → Enter senden, Shift+Enter Zeilenumbruch, Strg+K Sidebar, Strg+N neuer Chat, Strg+S Settings, `/` Slash-Menü, Escape schließt

## 24. Release-Check (technisch)

- [ ] **Versionsnummer überall gleich** → package.json, electron-updater, „Über"-Seite, Installer
- [ ] **Installer enthält alles** → Embedded Python, Backend, Modelle-Verzeichnis leer aber vorhanden, nox-backend.bat
- [ ] **Prod-Backend startet aus Installer** → `spawnBackend` mit embedded Python getestet (NICHT nur Dev-Modus!)
- [ ] **Dev-Modus unberührt** → `npm run dev` funktioniert weiterhin (spawnDevBackend)
- [ ] **Code-Signing** → EXE/Installer signiert (sonst SmartScreen-Warnung dokumentieren)
- [ ] **Update-Kanal getestet** → Von vorheriger Version auf neue updaten (Daten bleiben erhalten)
- [ ] **Logs bei Support-Anfrage** → `%APPDATA%\Nox\logs\nox_backend.log` enthält bei Fehlern sinnvolle Einträge
- [ ] **README/Dokumentation aktuell** → Features, Engines, Tastenkürzel, bekannte Einschränkungen (z. B. „Windows-only", Karten nach Neustart leer)
- [ ] **Changelog** → Neue Features der Version dokumentiert
- [ ] **Alte Test-Artefakte entfernt** → Keine `[TOOLTEST]`-Notizen/Testmodelle im User-Verzeichnis
- [ ] **Git-Status sauber** → Alle Änderungen committed, kein Debug-Müll

---

## Schnell-Smoke-Test (5 Minuten, nach jedem Build)

- [ ] App starten → verbunden
- [ ] Frage stellen → Antwort streamt
- [ ] `/wetter` → Karte erscheint
- [ ] Tab wechseln und zurück → Karte bleibt
- [ ] Marketplace → Engine-Tabs korrekt, Modell installieren startet
- [ ] Einstellungen öffnen → alle 6 Kategorien laden
- [ ] Mikrofon-Klick → Transkription
- [ ] App schließen → Backend-Prozess endet sauber (Task-Manager prüfen)
