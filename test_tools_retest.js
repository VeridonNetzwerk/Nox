// Retest only the two fixed tools
const http = require('http');
const OLLAMA_URL = 'http://localhost:11434/api/chat';
const MODEL = 'gemma4:e4b';

const ALL_TOOLS = [
  { type: 'function', function: { name: 'kontext_suche', description: 'Durchsucht den erfassten Bildschirmkontext nach einem Stichwort.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Suchbegriff oder Frage zum Kontext' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'notiz_speichern', description: 'Speichert eine Notiz fuer spaeter.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'Der Notiztext' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'aktuelle_uhrzeit', description: 'Gibt die aktuelle Uhrzeit und das Datum zurueck.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'dateien_suchen', description: 'Durchsucht lokale Dateien nach einem Stichwort.', parameters: { type: 'object', properties: { query: { type: 'string' }, ordner: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'datei_lesen', description: 'Liest den Textinhalt einer konkreten Datei.', parameters: { type: 'object', properties: { pfad: { type: 'string' } }, required: ['pfad'] } } },
  { type: 'function', function: { name: 'bildschirm_lesen', description: 'Liest den aktuellen Bildschirminhalt.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'screenshot_historie', description: 'Gibt eine Uebersicht der letzten Stunde Bildschirm-Historie zurueck.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'einstellungen_lesen', description: 'Listet alle Nox-Einstellungen mit aktuellem Wert auf.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'einstellung_aendern', description: 'Aendert eine Nox-Einstellung.', parameters: { type: 'object', properties: { key: { type: 'string' }, value: {} }, required: ['key', 'value'] } } },
  { type: 'function', function: { name: 'musik_erkennen', description: 'Erkennt den aktuell auf dem PC abgespielten Song.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'fenster_schliessen', description: 'Versteckt das Nox-Fenster.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'nox_beenden', description: 'Beendet Nox komplett.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'app_oeffnen', description: "Startet ein Programm oder oeffnet eine App auf dem PC. Verwende dies wenn der Nutzer sagt 'oeffne Chrome', 'starte Spotify', 'mach Word auf', 'oeffne den Taschenrechner' etc. Der Parameter 'name' ist der Name der App. Uebersetze deutsche Namen ins Englische: Taschenrechner/Rechner → 'calc', Editor → 'notepad', Zeichnung → 'mspaint', Einstellungen → 'ms-settings', Datei-Explorer → 'explorer', Task-Manager → 'taskmgr'. Gaengige Apps: chrome, firefox, edge, spotify, discord, vscode, notepad, calc, explorer.", parameters: { type: 'object', properties: { name: { type: 'string', description: "App-Name oder ausfuehrbare Datei (z.B. 'calc' fuer Taschenrechner, 'notepad' fuer Editor, 'chrome', 'spotify')" } }, required: ['name'] } } },
  { type: 'function', function: { name: 'system_steuerung', description: 'Steuert das System: PC sperren, herunterfahren, neu starten oder Ruhezustand.', parameters: { type: 'object', properties: { aktion: { type: 'string' } }, required: ['aktion'] } } },
  { type: 'function', function: { name: 'lautstaerke', description: 'Steuert die System-Lautstaerke.', parameters: { type: 'object', properties: { aktion: { type: 'string' }, wert: { type: 'number' } }, required: ['aktion'] } } },
  { type: 'function', function: { name: 'search_web', description: 'Durchsucht das Web nach aktuellen Informationen.', parameters: { type: 'object', properties: { query: { type: 'string' }, count: { type: 'number' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'website_oeffnen', description: 'Oeffnet eine Website im Browser oder startet eine Google-Suche.', parameters: { type: 'object', properties: { url_oder_suche: { type: 'string' } }, required: ['url_oder_suche'] } } },
  { type: 'function', function: { name: 'fenster_fokus', description: 'Wechselt zu einem Fenster, minimiert oder maximiert es.', parameters: { type: 'object', properties: { aktion: { type: 'string' }, name: { type: 'string' } }, required: ['aktion', 'name'] } } },
  { type: 'function', function: { name: 'timer_stellen', description: 'Stellt einen Timer, Wecker oder eine Erinnerung.', parameters: { type: 'object', properties: { aktion: { type: 'string' }, minuten: { type: 'number' }, sekunden: { type: 'number' }, uhrzeit: { type: 'string' }, nachricht: { type: 'string' } }, required: ['aktion'] } } },
  { type: 'function', function: { name: 'erinnerung_speichern', description: "Speichert eine langfristige persistente Erinnerung die einen Neustart ueberlebt. Verwende dies fuer Erinnerungen die Stunden, Tage oder Wochen in der Zukunft liegen: 'erinnere mich morgen an Muell rausbringen', 'am Freitag um 15 Uhr erinnern', 'naechste Woche Montag' etc. NICHT verwenden fuer kurze Timer wie 'in 5 Minuten' oder 'in 1 Stunde' — dafuer timer_stellen nutzen. Der Parameter 'aktion' bestimmt was passieren soll: 'speichern', 'liste', 'loeschen', 'abbrechen'. Fuer 'speichern': 'zeitpunkt' ist der Faelligkeitszeitpunkt (ISO-Format oder natuerliche Sprache), 'text' ist die Erinnerung. Fuer 'loeschen': 'id' ist die Erinnerungs-ID.", parameters: { type: 'object', properties: { aktion: { type: 'string' }, zeitpunkt: { type: 'string' }, text: { type: 'string' }, id: { type: 'number' } }, required: ['aktion'] } } },
  { type: 'function', function: { name: 'zwischenablage', description: 'Kopiert Text in die Zwischenablage oder liest Text aus der Zwischenablage.', parameters: { type: 'object', properties: { aktion: { type: 'string' }, text: { type: 'string' } }, required: ['aktion'] } } },
  { type: 'function', function: { name: 'wetter_abfragen', description: 'Fragt das aktuelle Wetter ab.', parameters: { type: 'object', properties: { ort: { type: 'string' }, tage: { type: 'number' } }, required: ['ort'] } } },
  { type: 'function', function: { name: 'uebersetzen', description: 'Uebersetzt Text von einer Sprache in eine andere.', parameters: { type: 'object', properties: { text: { type: 'string' }, zielsprache: { type: 'string' }, quellsprache: { type: 'string' } }, required: ['text', 'zielsprache'] } } },
  { type: 'function', function: { name: 'einheit_rechnen', description: 'Rechnet Werte zwischen verschiedenen Einheiten oder Waehrungen um.', parameters: { type: 'object', properties: { aktion: { type: 'string' }, wert: { type: 'number' }, von: { type: 'string' }, nach: { type: 'string' } }, required: ['aktion', 'wert', 'von', 'nach'] } } },
  { type: 'function', function: { name: 'bild_generieren', description: 'Generiert ein Bild aus einer Textbeschreibung.', parameters: { type: 'object', properties: { prompt: { type: 'string' }, stil: { type: 'string' }, groesse: { type: 'string' } }, required: ['prompt'] } } },
];

const tests = [
  // app_oeffnen tests — various German ways to say "open calculator"
  { name: 'app_oeffnen (Taschenrechner)', prompt: 'Öffne den Taschenrechner', expectedTool: 'app_oeffnen' },
  { name: 'app_oeffnen (Rechner)', prompt: 'Mach mal den Rechner auf', expectedTool: 'app_oeffnen' },
  { name: 'app_oeffnen (Editor)', prompt: 'Öffne den Editor', expectedTool: 'app_oeffnen' },
  { name: 'app_oeffnen (Spotify)', prompt: 'Starte Spotify', expectedTool: 'app_oeffnen' },
  // erinnerung_speichern — long-term reminders
  { name: 'erinnerung (morgen)', prompt: 'Erinnere mich morgen daran, den Müll rauszubringen', expectedTool: 'erinnerung_speichern' },
  { name: 'erinnerung (Freitag)', prompt: 'Erinnere mich am Freitag um 15 Uhr an das Meeting', expectedTool: 'erinnerung_speichern' },
  // Short-term should still use timer
  { name: 'timer (5 Min)', prompt: 'Erinnere mich in 5 Minuten an den Kuchen', expectedTool: 'timer_stellen' },
];

function callOllama(prompt, tools) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], tools, stream: false });
    const url = new URL(OLLAMA_URL);
    const options = { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 120000 };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`Parse error: ${e.message}`)); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log(`Retesting ${tests.length} prompts with model: ${MODEL}\n`);
  for (const test of tests) {
    process.stdout.write(`Testing: ${test.name}... `);
    try {
      const resp = await callOllama(test.prompt, ALL_TOOLS);
      const toolCalls = resp.message?.tool_calls || [];
      const content = resp.message?.content || '';
      const evalDur = (resp.eval_duration / 1e9).toFixed(1);
      if (toolCalls.length > 0) {
        const calledTool = toolCalls[0].function?.name || 'unknown';
        const args = JSON.stringify(toolCalls[0].function?.arguments || {});
        const correct = calledTool === test.expectedTool;
        console.log(`${correct ? '✅' : '⚠️ WRONG'} -> ${calledTool}(${args}) [${evalDur}s]`);
        if (!correct) console.log(`  Expected: ${test.expectedTool}`);
      } else if (content.length > 0) {
        console.log(`⚠️ NO_TOOL [${content.substring(0, 120)}...] [${evalDur}s]`);
      } else {
        console.log('❌ EMPTY');
      }
    } catch (e) {
      console.log(`❌ ERROR: ${e.message}`);
    }
  }
  process.exit(0);
}
main();
