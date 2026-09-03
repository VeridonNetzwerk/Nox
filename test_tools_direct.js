// Direct Ollama API tool test — tests each tool by sending a prompt with tool definitions
// to Ollama and checking if the model calls the correct tool

const http = require('http');

const OLLAMA_URL = 'http://localhost:11434/api/chat';
const MODEL = 'gemma4:e4b';

// Tool definitions matching the backend
const ALL_TOOLS = [
  { type: 'function', function: { name: 'kontext_suche', description: 'Durchsucht den erfassten Bildschirmkontext nach einem Stichwort.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Suchbegriff oder Frage zum Kontext' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'notiz_speichern', description: 'Speichert eine Notiz fuer spaeter.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'Der Notiztext' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'aktuelle_uhrzeit', description: 'Gibt die aktuelle Uhrzeit und das Datum zurueck.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'dateien_suchen', description: 'Durchsucht lokale Dateien nach einem Stichwort.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Suchbegriff' }, ordner: { type: 'string', description: 'Optional: Pfadpraefix' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'datei_lesen', description: 'Liest den Textinhalt einer konkreten Datei.', parameters: { type: 'object', properties: { pfad: { type: 'string', description: 'Vollstaendiger Dateipfad' } }, required: ['pfad'] } } },
  { type: 'function', function: { name: 'bildschirm_lesen', description: 'Liest den aktuellen Bildschirminhalt.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'screenshot_historie', description: 'Gibt eine Uebersicht der letzten Stunde Bildschirm-Historie zurueck.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'einstellungen_lesen', description: 'Listet alle Nox-Einstellungen mit aktuellem Wert auf.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'einstellung_aendern', description: 'Aendert eine Nox-Einstellung.', parameters: { type: 'object', properties: { key: { type: 'string' }, value: {} }, required: ['key', 'value'] } } },
  { type: 'function', function: { name: 'musik_erkennen', description: 'Erkennt den aktuell auf dem PC abgespielten Song.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'fenster_schliessen', description: 'Versteckt das Nox-Fenster.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'nox_beenden', description: 'Beendet Nox komplett.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'app_oeffnen', description: 'Startet ein Programm oder oeffnet eine App.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Name der App' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'system_steuerung', description: 'Steuert das System: PC sperren, herunterfahren, neu starten oder Ruhezustand.', parameters: { type: 'object', properties: { aktion: { type: 'string' } }, required: ['aktion'] } } },
  { type: 'function', function: { name: 'lautstaerke', description: 'Steuert die System-Lautstaerke.', parameters: { type: 'object', properties: { aktion: { type: 'string' }, wert: { type: 'number' } }, required: ['aktion'] } } },
  { type: 'function', function: { name: 'search_web', description: 'Durchsucht das Web nach aktuellen Informationen.', parameters: { type: 'object', properties: { query: { type: 'string' }, count: { type: 'number' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'website_oeffnen', description: 'Oeffnet eine Website im Browser oder startet eine Google-Suche.', parameters: { type: 'object', properties: { url_oder_suche: { type: 'string' } }, required: ['url_oder_suche'] } } },
  { type: 'function', function: { name: 'fenster_fokus', description: 'Wechselt zu einem Fenster, minimiert oder maximiert es.', parameters: { type: 'object', properties: { aktion: { type: 'string' }, name: { type: 'string' } }, required: ['aktion', 'name'] } } },
  { type: 'function', function: { name: 'timer_stellen', description: 'Stellt einen Timer, Wecker oder eine Erinnerung.', parameters: { type: 'object', properties: { aktion: { type: 'string' }, minuten: { type: 'number' }, sekunden: { type: 'number' }, uhrzeit: { type: 'string' }, nachricht: { type: 'string' } }, required: ['aktion'] } } },
  { type: 'function', function: { name: 'erinnerung_speichern', description: 'Speichert eine persistente Erinnerung mit Timestamp.', parameters: { type: 'object', properties: { aktion: { type: 'string' }, zeitpunkt: { type: 'string' }, text: { type: 'string' }, id: { type: 'number' } }, required: ['aktion'] } } },
  { type: 'function', function: { name: 'zwischenablage', description: 'Kopiert Text in die Zwischenablage oder liest Text aus der Zwischenablage.', parameters: { type: 'object', properties: { aktion: { type: 'string' }, text: { type: 'string' } }, required: ['aktion'] } } },
  { type: 'function', function: { name: 'wetter_abfragen', description: 'Fragt das aktuelle Wetter ab.', parameters: { type: 'object', properties: { ort: { type: 'string' }, tage: { type: 'number' } }, required: ['ort'] } } },
  { type: 'function', function: { name: 'uebersetzen', description: 'Uebersetzt Text von einer Sprache in eine andere.', parameters: { type: 'object', properties: { text: { type: 'string' }, zielsprache: { type: 'string' }, quellsprache: { type: 'string' } }, required: ['text', 'zielsprache'] } } },
  { type: 'function', function: { name: 'einheit_rechnen', description: 'Rechnet Werte zwischen verschiedenen Einheiten oder Waehrungen um.', parameters: { type: 'object', properties: { aktion: { type: 'string' }, wert: { type: 'number' }, von: { type: 'string' }, nach: { type: 'string' } }, required: ['aktion', 'wert', 'von', 'nach'] } } },
  { type: 'function', function: { name: 'bild_generieren', description: 'Generiert ein Bild aus einer Textbeschreibung.', parameters: { type: 'object', properties: { prompt: { type: 'string' }, stil: { type: 'string' }, groesse: { type: 'string' } }, required: ['prompt'] } } },
];

const tests = [
  { name: 'aktuelle_uhrzeit', prompt: 'Wie spaet ist es gerade?', expectedTool: 'aktuelle_uhrzeit' },
  { name: 'notiz_speichern', prompt: 'Speichere mir folgende Notiz: Test-Notiz 123', expectedTool: 'notiz_speichern' },
  { name: 'wetter_abfragen', prompt: 'Wie ist das aktuelle Wetter in Berlin?', expectedTool: 'wetter_abfragen' },
  { name: 'search_web', prompt: 'Suche im Web nach: was ist Python Programmierung', expectedTool: 'search_web' },
  { name: 'uebersetzen', prompt: "Uebersetze 'Hallo Welt' auf Englisch", expectedTool: 'uebersetzen' },
  { name: 'einheit_rechnen', prompt: 'Rechne 5 km in Meilen um', expectedTool: 'einheit_rechnen' },
  { name: 'dateien_suchen', prompt: 'Durchsuche meine Dateien nach: test', expectedTool: 'dateien_suchen' },
  { name: 'zwischenablage_kopieren', prompt: 'Kopiere "Test Text 123" in die Zwischenablage', expectedTool: 'zwischenablage' },
  { name: 'zwischenablage_einfuegen', prompt: 'Was ist in meiner Zwischenablage?', expectedTool: 'zwischenablage' },
  { name: 'website_oeffnen', prompt: 'Oeffne youtube.com im Browser', expectedTool: 'website_oeffnen' },
  { name: 'lautstaerke', prompt: 'Mach die Lautstaerke auf 50 Prozent', expectedTool: 'lautstaerke' },
  { name: 'timer_stellen', prompt: 'Stelle einen Timer auf 1 Sekunde mit dem Text Test', expectedTool: 'timer_stellen' },
  { name: 'erinnerung_speichern', prompt: 'Erinnere mich in 1 Minute an: Test-Erinnerung', expectedTool: 'erinnerung_speichern' },
  { name: 'einstellungen_lesen', prompt: 'Zeig mir meine aktuellen Einstellungen', expectedTool: 'einstellungen_lesen' },
  { name: 'bild_generieren', prompt: 'Generiere ein Bild von einer Katze', expectedTool: 'bild_generieren' },
  { name: 'app_oeffnen', prompt: 'Oeffne den Windows Rechner', expectedTool: 'app_oeffnen' },
  { name: 'kontext_suche', prompt: 'Durchsuche den Bildschirmkontext nach: test', expectedTool: 'kontext_suche' },
  { name: 'bildschirm_lesen', prompt: 'Lies mir vor was gerade auf dem Bildschirm steht', expectedTool: 'bildschirm_lesen' },
  { name: 'system_steuerung', prompt: 'Sperre den PC', expectedTool: 'system_steuerung' },
  { name: 'fenster_fokus', prompt: 'Wechsle zu Chrome', expectedTool: 'fenster_fokus' },
];

function callOllama(prompt, tools) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      tools: tools,
      stream: false,
    });

    const url = new URL(OLLAMA_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 120000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}, data: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log(`Testing ${tests.length} tools with model: ${MODEL}\n`);

  const results = [];

  for (const test of tests) {
    process.stdout.write(`Testing: ${test.name}... `);
    try {
      const resp = await callOllama(test.prompt, ALL_TOOLS);
      const toolCalls = resp.message?.tool_calls || [];
      const content = resp.message?.content || '';
      const thinking = resp.message?.thinking || '';
      const evalCount = resp.eval_count || 0;
      const loadDur = (resp.load_duration / 1e9).toFixed(1);
      const evalDur = (resp.eval_duration / 1e9).toFixed(1);

      if (toolCalls.length > 0) {
        const calledTool = toolCalls[0].function?.name || 'unknown';
        const args = JSON.stringify(toolCalls[0].function?.arguments || {});
        const correct = calledTool === test.expectedTool;
        const status = correct ? '✅' : '⚠️ WRONG_TOOL';
        console.log(`${status} -> ${calledTool}(${args}) [load:${loadDur}s eval:${evalDur}s ${evalCount}tok]`);
        if (!correct) console.log(`  Expected: ${test.expectedTool}, Got: ${calledTool}`);
        results.push({ name: test.name, status: correct ? 'OK' : 'WRONG_TOOL', calledTool, expectedTool: test.expectedTool, args, evalCount, loadDur, evalDur });
      } else if (content.length > 0) {
        console.log(`⚠️ NO_TOOL_CALL [content: ${content.substring(0, 100)}...] [load:${loadDur}s eval:${evalDur}s ${evalCount}tok]`);
        results.push({ name: test.name, status: 'NO_TOOL_CALL', content: content.substring(0, 200), evalCount, loadDur, evalDur });
      } else {
        console.log(`❌ EMPTY RESPONSE [load:${loadDur}s eval:${evalDur}s ${evalCount}tok]`);
        results.push({ name: test.name, status: 'EMPTY', evalCount, loadDur, evalDur });
      }
    } catch (e) {
      console.log(`❌ ERROR: ${e.message}`);
      results.push({ name: test.name, status: 'ERROR', error: e.message });
    }
  }

  // Summary
  console.log('\n\n========== SUMMARY ==========');
  const ok = results.filter(r => r.status === 'OK');
  const wrong = results.filter(r => r.status === 'WRONG_TOOL');
  const noTool = results.filter(r => r.status === 'NO_TOOL_CALL');
  const errors = results.filter(r => r.status === 'ERROR' || r.status === 'EMPTY');

  console.log(`\n✅ Correct tool call: ${ok.length}/${results.length}`);
  if (wrong.length > 0) {
    console.log(`\n⚠️  Wrong tool called: ${wrong.length}`);
    for (const r of wrong) console.log(`   ${r.name}: expected ${r.expectedTool}, got ${r.calledTool}`);
  }
  if (noTool.length > 0) {
    console.log(`\n⚠️  No tool called: ${noTool.length}`);
    for (const r of noTool.length) console.log(`   ${r.name}: ${r.content?.substring(0, 100)}`);
  }
  if (errors.length > 0) {
    console.log(`\n❌ Errors: ${errors.length}`);
    for (const r of errors) console.log(`   ${r.name}: ${r.error || r.status}`);
  }

  // Timing stats
  const timings = results.filter(r => r.loadDur);
  if (timings.length > 0) {
    const avgLoad = (timings.reduce((s, r) => s + parseFloat(r.loadDur), 0) / timings.length).toFixed(1);
    const avgEval = (timings.reduce((s, r) => s + parseFloat(r.evalDur), 0) / timings.length).toFixed(1);
    const avgTokens = Math.round(timings.reduce((s, r) => s + r.evalCount, 0) / timings.length);
    console.log(`\n📊 Timing: avg load ${avgLoad}s, avg eval ${avgEval}s, avg ${avgTokens} tokens`);
  }

  process.exit(0);
}

main();
