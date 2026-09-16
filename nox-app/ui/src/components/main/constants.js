import { MODEL_TABLE } from "../../shared/modelTable.js";

export const MODE_KEYS = ["superschnell", "schnell", "balance", "qualitaet"];

export const MODEL_TO_MODES = (() => {
    const map = {};
    for (const tier of MODEL_TABLE) {
      for (const modeKey of MODE_KEYS) {
        const entry = tier.modes[modeKey];
        if (entry?.model) {
          if (!map[entry.model]) map[entry.model] = [];
          if (!map[entry.model].includes(modeKey)) map[entry.model].push(modeKey);
        }
      }
    }
    return map;
})();

export const SLASH_COMMANDS = [
  { cmd: "/zusammenfassen", desc: "Text oder Bildschirm zusammenfassen", prompt: "Bitte fasse den folgenden Text kurz zusammen: " },
  { cmd: "/uebersetzen", desc: "Text übersetzen", prompt: "Bitte übersetze den folgenden Text auf Deutsch: " },
  { cmd: "/erklaeren", desc: "Konzept oder Code erklären", prompt: "Bitte erkläre das folgende Konzept verständlich: " },
  { cmd: "/code", desc: "Code generieren oder verbessern", prompt: "Bitte schreibe Code für: " },
  { cmd: "/notiz", desc: "Notiz speichern", prompt: "Speichere mir folgende Notiz: " },
  { cmd: "/uhrzeit", desc: "Aktuelle Uhrzeit und Datum", prompt: "Wie spät ist es?" },
  { cmd: "/wetter", desc: "Wetter über Web-Suche", prompt: "Wie ist das aktuelle Wetter?" },
  { cmd: "/bild", desc: "Bild generieren", prompt: "Generiere ein Bild von: " },
  { cmd: "/musik", desc: "Aktuellen Song erkennen", prompt: "Welcher Song spielt gerade?" },
  { cmd: "/dateien", desc: "Lokale Dateien durchsuchen", prompt: "Durchsuche meine Dateien nach: " },
  { cmd: "/einstellungen", desc: "Nox-Einstellungen anzeigen", prompt: "Zeige mir meine Einstellungen." },
  { cmd: "/brief", desc: "Tägliches Briefing generieren", prompt: "__BRIEF__" },
];
