// Tool test script — sends messages via WebSocket and captures responses
// Uses native WebSocket (Node 22+)

const WS_URL = 'ws://127.0.0.1:8420/ws/chat';

const tests = [
  { name: 'aktuelle_uhrzeit', prompt: 'Wie spät ist es gerade?' },
  { name: 'notiz_speichern', prompt: 'Speichere mir folgende Notiz: Test-Notiz 123' },
  { name: 'wetter_abfragen', prompt: 'Wie ist das aktuelle Wetter in Berlin?' },
  { name: 'search_web', prompt: 'Suche im Web nach: was ist Python Programmierung' },
  { name: 'uebersetzen', prompt: "Übersetze 'Hallo Welt' auf Englisch" },
  { name: 'einheit_rechnen', prompt: 'Rechne 5 km in Meilen um' },
  { name: 'dateien_suchen', prompt: 'Durchsuche meine Dateien nach: test' },
  { name: 'zwischenablage_kopieren', prompt: 'Kopiere "Test Text 123" in die Zwischenablage' },
  { name: 'zwischenablage_einfuegen', prompt: 'Was ist in meiner Zwischenablage?' },
  { name: 'website_oeffnen', prompt: 'Öffne youtube.com im Browser' },
  { name: 'lautstaerke', prompt: 'Mach die Lautstärke auf 50 Prozent' },
  { name: 'timer_stellen', prompt: 'Stelle einen Timer auf 1 Sekunde mit dem Text Test' },
  { name: 'erinnerung_speichern', prompt: 'Erinnere mich in 1 Minute an: Test-Erinnerung' },
  { name: 'einstellungen_lesen', prompt: 'Zeig mir meine aktuellen Einstellungen' },
  { name: 'kontext_suche', prompt: 'Durchsuche den Bildschirmkontext nach: test' },
  { name: 'bild_generieren', prompt: 'Generiere ein Bild von einer Katze' },
  { name: 'app_oeffnen', prompt: 'Öffne den Windows Rechner' },
];

function runTest(test) {
  return new Promise((resolve) => {
    console.log(`\n=== Testing: ${test.name} ===`);
    console.log(`Prompt: ${test.prompt}`);

    const ws = new WebSocket(WS_URL);
    let fullResponse = '';
    let toolCalls = [];
    let toolResults = [];
    let hadError = false;
    let errorMsg = '';
    const startTime = Date.now();
    const timeout = 60000; // 60s per test
    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      console.log('  TIMEOUT');
      try { ws.close(); } catch {}
      finish({ name: test.name, status: 'TIMEOUT', response: fullResponse, toolCalls, toolResults });
    }, timeout);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'message', content: test.prompt }));
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'token') {
          fullResponse += msg.content;
        } else if (msg.type === 'tool_call') {
          toolCalls.push(msg.tool || msg.name || 'unknown');
          fullResponse += `[TOOL_CALL: ${msg.tool || msg.name}]`;
        } else if (msg.type === 'tool_result') {
          const resultStr = typeof msg.result === 'string' ? msg.result.substring(0, 200) : JSON.stringify(msg.result).substring(0, 200);
          toolResults.push(resultStr);
          fullResponse += `[TOOL_RESULT: ${resultStr}]`;
        } else if (msg.type === 'done') {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const preview = fullResponse.substring(0, 400);
          console.log(`  Response (${elapsed}s): ${preview}`);

          if (hadError) {
            console.log(`  STATUS: ERROR - ${errorMsg}`);
            finish({ name: test.name, status: 'ERROR', response: fullResponse, toolCalls, toolResults, error: errorMsg });
          } else if (toolCalls.length > 0 || fullResponse.length > 10) {
            console.log(`  STATUS: OK (tools: ${toolCalls.join(', ') || 'none'})`);
            finish({ name: test.name, status: 'OK', response: fullResponse, toolCalls, toolResults });
          } else {
            console.log('  STATUS: EMPTY');
            finish({ name: test.name, status: 'EMPTY', response: fullResponse, toolCalls, toolResults });
          }
          try { ws.close(); } catch {}
        } else if (msg.type === 'error') {
          hadError = true;
          errorMsg = msg.content || 'unknown error';
          fullResponse += `[ERROR: ${msg.content}]`;
        }
      } catch (e) {
        // ignore parse errors
      }
    });

    ws.addEventListener('error', (err) => {
      console.log(`  WS ERROR: ${err.message || err}`);
      finish({ name: test.name, status: 'WS_ERROR', response: fullResponse, toolCalls, toolResults, error: err.message || 'ws error' });
    });

    ws.addEventListener('close', () => {
      // If not already resolved, treat as done
    });
  });
}

async function main() {
  const results = [];
  for (const test of tests) {
    const result = await runTest(test);
    results.push(result);
    // Wait between tests
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n\n========== SUMMARY ==========');
  for (const r of results) {
    const icon = r.status === 'OK' ? '✅' : r.status === 'ERROR' || r.status === 'WS_ERROR' ? '❌' : '⚠️';
    const tools = r.toolCalls && r.toolCalls.length > 0 ? ` (tools: ${r.toolCalls.join(', ')})` : '';
    console.log(`  ${icon} ${r.name}: ${r.status}${tools}`);
  }

  // Print full details for non-OK results
  const failures = results.filter(r => r.status !== 'OK');
  if (failures.length > 0) {
    console.log('\n\n========== DETAILS (non-OK) ==========');
    for (const r of failures) {
      console.log(`\n--- ${r.name} (${r.status}) ---`);
      console.log(`  Response: ${(r.response || '').substring(0, 500)}`);
      if (r.error) console.log(`  Error: ${r.error}`);
    }
  }

  process.exit(0);
}

main();
