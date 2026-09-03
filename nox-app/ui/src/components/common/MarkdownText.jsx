import React, { useState } from "react";

const API_BASE = "http://127.0.0.1:8420";

function getDomainName(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function getFolderName(path) {
  const parts = path.replace(/\\/g, "/").replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || path;
}

function getFileName(path) {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function parseFilePath(rawPath) {
  // Split optional :line:col suffix from path
  // e.g. C:\code\file.py:42 → { path: "C:\code\file.py", line: 42 }
  // e.g. C:\code\file.py:42:10 → { path: "C:\code\file.py", line: 42, col: 10 }
  const m = rawPath.match(/^(.+):(\d+)(?::(\d+))?$/);
  if (m && m[1].length > 2) {
    // Make sure m[1] is not just a drive letter like "C:"
    const possiblePath = m[1];
    if (possiblePath.length > 3 || possiblePath.includes("\\") || possiblePath.includes("/")) {
      return { path: m[1], line: parseInt(m[2], 10), col: m[3] ? parseInt(m[3], 10) : null };
    }
  }
  return { path: rawPath, line: null, col: null };
}

function renderInline(text) {
  const parts = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    let earliest = null;
    let earliestType = null;
    let earliestMatch = null;

    const patterns = [
      { type: "code", re: /`([^`]+)`/ },
      { type: "bold", re: /\*\*([^*]+)\*\*/ },
      { type: "italic", re: /(?<!\*)\*([^*]+)\*(?!\*)/ },
      { type: "link", re: /\[([^\]]+)\]\(([^)]+)\)/ },
      { type: "filepath", re: /(?:^|[\s(])([A-Za-z]:\\[^\s"<>|*?]+|\\\\[^\s"<>|*?]+)/ },
      { type: "url", re: /(?:^|[\s(])(https?:\/\/[^\s<>)]+)/ },
    ];

    for (const p of patterns) {
      const m = remaining.match(p.re);
      if (m && (earliest === null || m.index < earliest)) {
        earliest = m.index;
        earliestType = p.type;
        earliestMatch = m;
      }
    }

    if (earliest === null) {
      parts.push(remaining);
      break;
    }

    // For filepath and url patterns, the match may include a leading space or paren
    const isCapturedWithPrefix = earliestType === "filepath" || earliestType === "url";
    const prefixLen = isCapturedWithPrefix ? (earliestMatch[0].length - earliestMatch[1].length) : 0;

    if (earliest > 0) parts.push(remaining.slice(0, earliest));
    if (isCapturedWithPrefix && prefixLen > 0) parts.push(remaining.slice(earliest, earliest + prefixLen));

    const m = earliestMatch;
    const matchStart = earliest + prefixLen;
    const matchText = m[1];

    if (earliestType === "code") {
      parts.push(<code key={key++} className="px-1 py-0.5 rounded bg-nox-surface text-nox-accent text-[0.85em] font-mono">{m[1]}</code>);
    } else if (earliestType === "bold") {
      parts.push(<strong key={key++} className="font-semibold text-nox-text">{m[1]}</strong>);
    } else if (earliestType === "italic") {
      parts.push(<em key={key++}>{m[1]}</em>);
    } else if (earliestType === "link") {
      parts.push(<a key={key++} href={m[2]} target="_blank" rel="noopener noreferrer" className="text-nox-accent hover:underline">{m[1]}</a>);
    } else if (earliestType === "url") {
      const domain = getDomainName(matchText);
      parts.push(<a key={key++} href={matchText} target="_blank" rel="noopener noreferrer" className="text-nox-accent hover:underline">{domain}</a>);
    } else if (earliestType === "filepath") {
      const parsed = parseFilePath(matchText);
      const fileName = getFileName(parsed.path);
      const displayText = parsed.line ? `${fileName}:${parsed.line}` : fileName;
      const tooltip = parsed.line ? `${parsed.path}:${parsed.line}` : parsed.path;
      const clickPayload = parsed.line ? { path: parsed.path, line: parsed.line } : parsed.path;
      parts.push(
        <span
          key={key++}
          className="text-nox-accent hover:underline cursor-pointer font-mono text-[0.85em] inline-flex items-center gap-0.5"
          title={tooltip}
          onClick={() => window.nox?.openPath?.(clickPayload)}
        >
          {displayText}
        </span>
      );
    }

    remaining = remaining.slice(matchStart + matchText.length);
  }

  return parts;
}

function parseTable(lines, startIndex) {
  const headerLine = lines[startIndex];
  const separatorLine = lines[startIndex + 1];
  if (!separatorLine || !separatorLine.match(/^\s*\|?[\s\-:|]+\|?\s*$/)) return null;

  const parseRow = (line) => {
    return line.split("|").map(c => c.trim()).filter((_, i, arr) => {
      if (i === 0 && arr[0] === "") return false;
      if (i === arr.length - 1 && arr[arr.length - 1] === "") return false;
      return true;
    });
  };

  const headers = parseRow(headerLine);
  const rows = [];
  let i = startIndex + 2;
  while (i < lines.length && lines[i].trim().startsWith("|")) {
    rows.push(parseRow(lines[i]));
    i++;
  }

  return { headers, rows, endIndex: i };
}

export default function MarkdownText({ content, className = "", addToast }) {
  if (!content) return null;

  const lines = content.split("\n");
  const elements = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      const codeContent = codeLines.join("\n");
      const supportedLangs = ["python", "py", "shell", "sh", "bash", "cmd", "powershell"];
      const isExecutable = supportedLangs.includes(lang.toLowerCase());
      elements.push(
        <CodeBlock key={key++} code={codeContent} lang={lang} isExecutable={isExecutable} addToast={addToast} />
      );
      continue;
    }

    if (trimmed.startsWith("### ")) {
      elements.push(<h4 key={key++} className="text-sm font-semibold text-nox-text mt-3 mb-1">{renderInline(trimmed.slice(4))}</h4>);
      i++;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      elements.push(<h3 key={key++} className="text-base font-semibold text-nox-text mt-3 mb-1">{renderInline(trimmed.slice(3))}</h3>);
      i++;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      elements.push(<h2 key={key++} className="text-lg font-bold text-nox-text mt-3 mb-1">{renderInline(trimmed.slice(2))}</h2>);
      i++;
      continue;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const items = [];
      while (i < lines.length && (lines[i].trim().startsWith("- ") || lines[i].trim().startsWith("* "))) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      elements.push(
        <ul key={key++} className="my-1 ml-4 space-y-0.5 list-disc list-outside">
          {items.map((item, idx) => <li key={idx} className="text-sm text-nox-textLight">{renderInline(item)}</li>)}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ""));
        i++;
      }
      elements.push(
        <ol key={key++} className="my-1 ml-4 space-y-0.5 list-decimal list-outside">
          {items.map((item, idx) => <li key={idx} className="text-sm text-nox-textLight">{renderInline(item)}</li>)}
        </ol>
      );
      continue;
    }

    if (trimmed.startsWith("|")) {
      const table = parseTable(lines, i);
      if (table) {
        elements.push(
          <div key={key++} className="my-2 overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-nox-border">
                  {table.headers.map((h, idx) => <th key={idx} className="text-left px-2 py-1 text-nox-text font-semibold">{renderInline(h)}</th>)}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, ridx) => (
                  <tr key={ridx} className="border-b border-nox-border/50">
                    {row.map((cell, cidx) => <td key={cidx} className="px-2 py-1 text-nox-textLight">{renderInline(cell)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        i = table.endIndex;
        continue;
      }
    }

    if (trimmed.startsWith("> ")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      elements.push(
        <blockquote key={key++} className="my-2 pl-3 border-l-2 border-nox-accent/40 text-sm text-nox-textDim italic">
          {renderInline(quoteLines.join(" "))}
        </blockquote>
      );
      continue;
    }

    elements.push(<p key={key++} className="text-sm text-nox-textLight leading-relaxed my-0.5">{renderInline(trimmed)}</p>);
    i++;
  }

  return <div className={className}>{elements}</div>;
}

function CodeBlock({ code, lang, isExecutable, addToast }) {
  const [output, setOutput] = useState(null);
  const [running, setRunning] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  const handleRun = async () => {
    setRunning(true);
    setShowOutput(true);
    setOutput("Wird ausgeführt…");
    try {
      const res = await fetch(`${API_BASE}/api/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, lang }),
      });
      const data = await res.json();
      if (data.status === "ok") {
        setOutput(data.output);
        addToast?.({ type: "info", title: "Code ausgeführt", message: `Exit-Code: ${data.exit_code}`, duration: 3000 });
      } else {
        setOutput(`Fehler: ${data.error}`);
        addToast?.({ type: "warning", title: "Ausführung fehlgeschlagen", message: data.error, duration: 4000 });
      }
    } catch (err) {
      setOutput(`Fehler: ${err.message}`);
      addToast?.({ type: "warning", title: "Ausführung fehlgeschlagen", message: err.message, duration: 4000 });
    }
    setRunning(false);
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(code);
    addToast?.({ type: "info", title: "Kopiert", message: "Code in Zwischenablage kopiert", duration: 2000 });
  };

  return (
    <div className="my-2 rounded-lg bg-nox-bg border border-nox-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-nox-border bg-nox-surface-hover/30">
        <span className="text-[10px] font-mono text-nox-textFaint uppercase">{lang || "code"}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="text-[10px] px-2 py-0.5 rounded text-nox-textDim hover:text-nox-text hover:bg-nox-border/50 transition-colors"
          >
            Kopieren
          </button>
          {isExecutable && (
            <button
              onClick={handleRun}
              disabled={running}
              className="text-[10px] px-2 py-0.5 rounded text-nox-accent hover:bg-nox-accent/10 transition-colors disabled:opacity-50"
            >
              {running ? "…" : "Ausführen"}
            </button>
          )}
        </div>
      </div>
      <pre className="overflow-x-auto">
        <code className="block p-3 text-xs font-mono text-nox-textLight leading-relaxed">{code}</code>
      </pre>
      {showOutput && output && (
        <div className="border-t border-nox-border p-3 bg-nox-bg/50">
          <div className="text-[10px] font-mono text-nox-textFaint uppercase mb-1">Ausgabe</div>
          <pre className="text-xs font-mono text-nox-textLight whitespace-pre-wrap break-all">{output}</pre>
        </div>
      )}
    </div>
  );
}
