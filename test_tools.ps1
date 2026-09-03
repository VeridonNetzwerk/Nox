# Tool test script — sends messages via WebSocket and captures responses
# Uses .NET ClientWebSocket

$wsUrl = "ws://127.0.0.1:8420/ws"

$tests = @(
    @{ name = "aktuelle_uhrzeit"; prompt = "Wie spät ist es gerade?" },
    @{ name = "notiz_speichern"; prompt = "Speichere mir folgende Notiz: Test-Notiz 123" },
    @{ name = "wetter_abfragen"; prompt = "Wie ist das aktuelle Wetter in Berlin?" },
    @{ name = "search_web"; prompt = "Suche im Web nach: was ist Python Programmierung" },
    @{ name = "uebersetzen"; prompt = "Übersetze 'Hallo Welt' auf Englisch" },
    @{ name = "einheit_rechnen"; prompt = "Rechne 5 km in Meilen um" },
    @{ name = "dateien_suchen"; prompt = "Durchsuche meine Dateien nach: test" },
    @{ name = "zwischenablage_kopieren"; prompt = "Kopiere 'Test Text 123' in die Zwischenablage" },
    @{ name = "zwischenablage_einfuegen"; prompt = "Was ist in meiner Zwischenablage?" },
    @{ name = "website_oeffnen"; prompt = "Öffne youtube.com im Browser" },
    @{ name = "lautstaerke"; prompt = "Mach die Lautstärke auf 50 Prozent" },
    @{ name = "timer_stellen"; prompt = "Stelle einen Timer auf 1 Sekunde mit dem Text Test" },
    @{ name = "erinnerung_speichern"; prompt = "Erinnere mich in 1 Minute an: Test-Erinnerung" },
    @{ name = "einstellungen_lesen"; prompt = "Zeig mir meine aktuellen Einstellungen" },
    @{ name = "kontext_suche"; prompt = "Durchsuche den Bildschirmkontext nach: test" }
)

$results = @()

foreach ($test in $tests) {
    Write-Host "`n=== Testing: $($test.name) ===" -ForegroundColor Cyan
    Write-Host "Prompt: $($test.prompt)" -ForegroundColor Gray

    try {
        $ws = New-Object System.Net.WebSockets.ClientWebSocket
        $ct = New-Object System.Threading.CancellationTokenSource(60000)
        $connectTask = $ws.ConnectAsync($wsUrl, $ct.Token)
        $connectTask.Wait(15000)

        if ($ws.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
            Write-Host "  FAILED: WebSocket not connected" -ForegroundColor Red
            $results += @{ name = $test.name; status = "FAIL"; error = "WS not connected" }
            continue
        }

        # Send message
        $msg = @{ type = "message"; content = $test.prompt } | ConvertTo-Json -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
        $sendTask = $ws.SendAsync($bytes, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct.Token)
        $sendTask.Wait(10000)

        # Collect response
        $fullResponse = ""
        $buffer = New-Object byte[] 8192
        $startTime = Get-Date
        $timeout = 45  # seconds

        while ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
            $elapsed = ((Get-Date) - $startTime).TotalSeconds
            if ($elapsed -gt $timeout) {
                Write-Host "  TIMEOUT after ${timeout}s" -ForegroundColor Yellow
                break
            }

            $recvTask = $ws.ReceiveAsync($buffer, $ct.Token)
            $recvTask.Wait(5000)

            if ($recvTask.Result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                break
            }

            $chunk = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $recvTask.Result.Count)
            try {
                $json = $chunk | ConvertFrom-Json
                if ($json.type -eq "token") {
                    $fullResponse += $json.content
                } elseif ($json.type -eq "tool_call") {
                    $fullResponse += "[TOOL_CALL: $($json.tool)]"
                } elseif ($json.type -eq "tool_result") {
                    $fullResponse += "[TOOL_RESULT: $($json.result)]"
                } elseif ($json.type -eq "done") {
                    break
                } elseif ($json.type -eq "error") {
                    $fullResponse += "[ERROR: $($json.content)]"
                    break
                }
            } catch {
                # ignore parse errors
            }
        }

        $ws.Dispose()
        $ct.Dispose()

        $responsePreview = $fullResponse.Substring(0, [Math]::Min(300, $fullResponse.Length))
        Write-Host "  Response: $responsePreview" -ForegroundColor Green

        $hasToolCall = $fullResponse -match "\[TOOL_CALL:"
        $hasError = $fullResponse -match "\[ERROR:"
        $hasContent = $fullResponse.Length -gt 10

        if ($hasError) {
            $results += @{ name = $test.name; status = "ERROR"; response = $responsePreview }
            Write-Host "  STATUS: ERROR" -ForegroundColor Red
        } elseif ($hasToolCall -or $hasContent) {
            $results += @{ name = $test.name; status = "OK"; response = $responsePreview }
            Write-Host "  STATUS: OK" -ForegroundColor Green
        } else {
            $results += @{ name = $test.name; status = "EMPTY"; response = $responsePreview }
            Write-Host "  STATUS: EMPTY" -ForegroundColor Yellow
        }

        Start-Sleep -Seconds 2  # Give backend time to reset between requests
    } catch {
        Write-Host "  EXCEPTION: $_" -ForegroundColor Red
        $results += @{ name = $test.name; status = "EXCEPTION"; error = "$_" }
    }
}

Write-Host "`n`n=== SUMMARY ===" -ForegroundColor Magenta
foreach ($r in $results) {
    $color = switch ($r.status) {
        "OK" { "Green" }
        "ERROR" { "Red" }
        "EMPTY" { "Yellow" }
        "FAIL" { "Red" }
        "EXCEPTION" { "Red" }
        default { "Gray" }
    }
    Write-Host "  $($r.name): $($r.status)" -ForegroundColor $color
}
