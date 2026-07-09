# Nox – Testplan (manuelle End-to-End-Tests)

> Alle Tests auf einem sauberen Windows 11 System mit vorinstalliertem Ollama durchführen.

## Voraussetzungen

- Windows 11
- Ollama installiert und laufend (`ollama serve`)
- Mindestens ein Ollama-Modell gepullt (`ollama pull llama3.1`)
- Mikrofon angeschlossen (für Voice-Tests)
- Nox installiert via `Nox-Setup-x.x.x.exe`

---

## 1. Wake-Word → Antwort (Voice Pipeline)

| Schritt | Aktion | Erwartetes Ergebnis |
|---|---|---|
| 1 | Nox läuft im Tray (lila Icon) | Tray-Icon sichtbar, Prozess aktiv |
| 2 | Sag "Hey Nox" | Fenster erschent mit Slide-In-Animation, Voice-State → "listening" |
| 3 | Stelle eine Frage (z.B. "Wie spät ist es?") | Voice-State → "processing" (Transkription), dann "thinking" |
| 4 | Warte auf Antwort | Antwort wird token-weise gestreamt, Voice-State → "speaking" |
| 5 | Antwort komplett | TTS liest Antwort vor, Voice-State → "idle" |
| 6 | Fenster versteckt sich nach Timeout | Tray-Icon bleibt lila |

**Fehlerfall:** Wake-Word-Modell fehlt → Gelbe Warnung im UI, Mic-Button ausgegraut.

## 2. Text-Chat

| Schritt | Aktion | Erwartetes Ergebnis |
|---|---|---|
| 1 | Hotkey `Strg+Umschalt+Leertaste` drücken | Fenster erschent |
| 2 | Text eingeben: "Was ist Python?" | Senden-Button aktiv |
| 3 | Enter drücken | User-Message erscheint, "Nox denkt nach"-Indikator |
| 4 | Warte auf Streaming | Token-weise Antwort erscheint, Cursor blinkt |
| 5 | Antwort komplett | "Done"-Event, Streaming stoppt |
| 6 | Weitere Frage stellen | Konversationsverlauf wird berücksichtigt (Follow-up möglich) |

**Fehlerfall:** Ollama nicht erreichbar → Roter Banner mit "Status prüfen"-Button.

## 3. Kontext-Injection

| Schritt | Aktion | Erwartetes Ergebnis |
|---|---|---|
| 1 | Öffne VS Code mit einer Python-Datei | nox_eye erfasst Fenster + UIA-Text |
| 2 | Wechsle zu Nox, frage: "Was mache ich gerade?" | Antwort bezieht sich auf VS Code / Python |
| 3 | Kopiere einen Text in die Zwischenablage | nox_eye erfasst Clipboard |
| 4 | Frage: "Was habe ich kopiert?" | Antwort bezieht sich auf Clipboard-Inhalt |

## 4. Settings-Änderung

| Schritt | Aktion | Erwartetes Ergebnis |
|---|---|---|
| 1 | Settings-Button (Zahnrad) klicken | Settings-Panel slide-in |
| 2 | Modell ändern (Dropdown) | Änderung sofort wirksam, nächste Antwort nutzt neues Modell |
| 3 | Wake-Word-Schwellenwert ändern (Slider) | Schwellenwert sofort angewandt |
| 4 | App zur Ausschlussliste hinzufügen | Chip erscheint, App wird nicht mehr erfasst |
| 5 | Theme auf "Hell" ändern | UI wechselt zu hellem Theme |
| 6 | Hotkey ändern | Neuer Hotkey sofort registriert (alter funktioniert nicht mehr) |
| 7 | Settings schließen und wieder öffnen | Alle Werte persistent (aus %APPDATA%\Nox\config.yaml) |

## 5. Neustart-Verhalten

| Schritt | Aktion | Erwartetes Ergebnis |
|---|---|---|
| 1 | Konversation führen | Turns in SQLite gespeichert |
| 2 | Nox beenden (Tray → Beenden) | Prozess sauber beendet |
| 3 | Nox neu starten | Config aus %APPDATA% geladen, Konversationsverlauf verfügbar |
| 4 | "Was hatten wir besprochen?" | Nox kann auf frühere Turns zugreifen |
| 5 | Autostart aktivieren, Windows neu starten | Nox startet automatisch mit Windows |

## 6. Multi-Monitor-Positionierung

| Schritt | Aktion | Erwartetes Ergebnis |
|---|---|---|
| 1 | Hotkey auf Monitor 1 drücken | Fenster erscheht unten rechts auf Monitor 1 |
| 2 | Maus auf Monitor 2 bewegen, Hotkey drücken | Fenster erscheht unten rechts auf Monitor 2 |
| 3 | Maus auf Monitor 3 (falls vorhanden), Hotkey | Fenster auf Monitor 3 |
| 4 | Fenster auf Monitor 2, klick außerhalb | Fenster versteckt sich mit Fade-Out |

## 7. Pause/Fortsetzen (Kontext-Erfassung)

| Schritt | Aktion | Erwartetes Ergebnis |
|---|---|---|
| 1 | Tray → "Pause (Kontext-Erfassung)" | Tray-Icon wird grau, nox_eye pausiert |
| 2 | Fenster wechseln, Text kopieren | Keine Erfassung (im Log prüfbar) |
| 3 | Frage stellen | Antwort ohne aktuellen Kontext |
| 4 | Tray → "Fortsetzen" | Tray-Icon wird lila, nox_eye aktiv |
| 5 | Fenster wechseln | Erfassung läuft wieder |

## 8. Onboarding-Assistent (Erststart)

| Schritt | Aktion | Erwartetes Ergebnis |
|---|---|---|
| 1 | Nox zum ersten Mal starten | Onboarding-Assistent erscheint |
| 2 | Modell aus Dropdown wählen | Auswahl gespeichert |
| 3 | Mikrofon-Test: "Test" sagen | VU-Meter reagiert, Test erfolgreich |
| 4 | Wake-Word-Kalibrierung: 3× "Hey Nox" sagen | Erkennung bestätigt |
| 5 | Assistent abschließen | Haupt-Chat-UI erscheint |

## 9. Fehlerzustände

| Szenario | Aktion | Erwartetes Ergebnis |
|---|---|---|
| Ollama gestoppt | Frage senden | Roter Banner, "Status prüfen"-Button, kein Einfrieren |
| Mikrofon abgezogen | Mic-Button klicken | Button ausgegraut, Text-Chat funktioniert |
| Wake-Word-Modell gelöscht | Neustart | Gelbe Warnung, Voice deaktiviert, Text nutzbar |
| Backend absturz | Frage senden | UI zeigt "Getrennt", Reconnect nach 2s |
