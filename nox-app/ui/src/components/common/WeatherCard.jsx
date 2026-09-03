import React from "react";

const WEATHER_ICONS = {
  0: { icon: "☀️", label: "Klar", gradient: "from-amber-500/20 to-orange-500/10" },
  1: { icon: "🌤️", label: "Überwiegend klar", gradient: "from-amber-500/15 to-blue-500/10" },
  2: { icon: "⛅", label: "Teilweise bewölkt", gradient: "from-blue-500/15 to-gray-500/10" },
  3: { icon: "☁️", label: "Bedeckt", gradient: "from-gray-500/20 to-gray-600/10" },
  45: { icon: "🌫️", label: "Nebel", gradient: "from-gray-500/15 to-gray-700/10" },
  48: { icon: "🌫️", label: "Reifnebel", gradient: "from-gray-500/15 to-gray-700/10" },
  51: { icon: "🌦️", label: "Leichter Nieselregen", gradient: "from-blue-500/15 to-cyan-500/10" },
  53: { icon: "🌦️", label: "Mäßiger Nieselregen", gradient: "from-blue-500/15 to-cyan-500/10" },
  55: { icon: "🌧️", label: "Dichter Nieselregen", gradient: "from-blue-600/20 to-cyan-600/10" },
  61: { icon: "🌧️", label: "Leichter Regen", gradient: "from-blue-500/15 to-cyan-500/10" },
  63: { icon: "🌧️", label: "Mäßiger Regen", gradient: "from-blue-600/20 to-cyan-600/10" },
  65: { icon: "🌧️", label: "Starker Regen", gradient: "from-blue-700/25 to-cyan-700/10" },
  71: { icon: "🌨️", label: "Leichter Schneefall", gradient: "from-sky-500/15 to-blue-500/10" },
  73: { icon: "🌨️", label: "Mäßiger Schneefall", gradient: "from-sky-500/15 to-blue-500/10" },
  75: { icon: "❄️", label: "Starker Schneefall", gradient: "from-sky-600/20 to-blue-600/10" },
  77: { icon: "❄️", label: "Schneegriesel", gradient: "from-sky-500/15 to-blue-500/10" },
  80: { icon: "🌦️", label: "Leichte Regenschauer", gradient: "from-blue-500/15 to-cyan-500/10" },
  81: { icon: "🌧️", label: "Mäßige Regenschauer", gradient: "from-blue-600/20 to-cyan-600/10" },
  82: { icon: "⛈️", label: "Heftige Regenschauer", gradient: "from-blue-700/25 to-cyan-700/10" },
  85: { icon: "🌨️", label: "Leichte Schneeschauer", gradient: "from-sky-500/15 to-blue-500/10" },
  86: { icon: "❄️", label: "Starke Schneeschauer", gradient: "from-sky-600/20 to-blue-600/10" },
  95: { icon: "⛈️", label: "Gewitter", gradient: "from-purple-600/20 to-indigo-600/10" },
  96: { icon: "⛈️", label: "Gewitter mit Hagel", gradient: "from-purple-600/25 to-indigo-600/10" },
  99: { icon: "⛈️", label: "Gewitter mit starkem Hagel", gradient: "from-purple-700/25 to-indigo-700/10" },
};

function getWeatherMeta(code) {
  return WEATHER_ICONS[code] || { icon: "🌡️", label: "Unbekannt", gradient: "from-gray-500/15 to-gray-600/10" };
}

function windDirToText(deg) {
  if (deg == null || deg === "?") return "";
  const dirs = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
  const idx = Math.round(deg / 45) % 8;
  return dirs[idx];
}

function formatTemp(t) {
  if (t == null || t === "?") return "–";
  return Math.round(t);
}

export default function WeatherCard({ data }) {
  if (!data || !data.current || data.current.temp == null) return null;

  const c = data.current;
  const meta = getWeatherMeta(c.weather_code);
  const hourly = data.hourly || [];
  const windText = windDirToText(c.wind_dir);

  return (
    <div className="max-w-md rounded-2xl border border-nox-border bg-nox-surface overflow-hidden animate-bubble-in shadow-xl shadow-nox-shadow">
      {/* Header with gradient based on weather */}
      <div className={`relative bg-gradient-to-br ${meta.gradient} px-5 py-4`}>
        <div>
          <div className="text-xs text-nox-textDim font-medium uppercase tracking-wide">Wetter · Jetzt</div>
          <div className="text-sm text-nox-text mt-0.5 font-medium">{data.location}</div>
        </div>

        {/* Main temp display */}
        <div className="flex items-center gap-4 mt-3">
          <div className="text-5xl">{meta.icon}</div>
          <div>
            <div className="text-4xl font-light text-nox-text tracking-tight">
              {formatTemp(c.temp)}°
            </div>
            <div className="text-sm text-nox-textDim mt-0.5">{meta.label}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-xs text-nox-textDim">Gefühlt</div>
            <div className="text-lg text-nox-text font-medium">{formatTemp(c.feels_like)}°</div>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-px bg-nox-border/50">
        <div className="bg-nox-surface px-3 py-2.5 text-center">
          <div className="text-[10px] text-nox-textDim uppercase tracking-wide">Feuchte</div>
          <div className="text-sm text-nox-text font-medium mt-0.5">{c.humidity}%</div>
        </div>
        <div className="bg-nox-surface px-3 py-2.5 text-center">
          <div className="text-[10px] text-nox-textDim uppercase tracking-wide">Wind</div>
          <div className="text-sm text-nox-text font-medium mt-0.5">{Math.round(c.wind_speed || 0)} <span className="text-[10px] text-nox-textDim">km/h</span></div>
          {windText && <div className="text-[9px] text-nox-textDim mt-0.5">({windText})</div>}
        </div>
        <div className="bg-nox-surface px-3 py-2.5 text-center">
          <div className="text-[10px] text-nox-textDim uppercase tracking-wide">Regen</div>
          <div className="text-sm text-nox-text font-medium mt-0.5">{c.precipitation} <span className="text-[10px] text-nox-textDim">mm</span></div>
        </div>
        <div className="bg-nox-surface px-3 py-2.5 text-center">
          <div className="text-[10px] text-nox-textDim uppercase tracking-wide">Druck</div>
          <div className="text-sm text-nox-text font-medium mt-0.5">{Math.round(c.pressure || 0)} <span className="text-[10px] text-nox-textDim">hPa</span></div>
        </div>
      </div>

      {/* Hourly forecast */}
      {hourly.length > 0 && (
        <div className="px-3 py-2 border-t border-nox-border">
          <div className="text-[10px] text-nox-textDim uppercase tracking-wide mb-1.5 px-2">Stündlich</div>
          <div className="flex gap-1 overflow-x-auto">
            {hourly.map((h, i) => {
              const hMeta = getWeatherMeta(h.weather_code);
              return (
                <div
                  key={i}
                  className={`flex-shrink-0 flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg ${h.is_now ? "bg-nox-accent/10 ring-1 ring-nox-accent/30" : ""}`}
                >
                  <span className="text-[10px] text-nox-textDim">{h.is_now ? "Jetzt" : h.time}</span>
                  <span className="text-lg">{hMeta.icon}</span>
                  <span className="text-xs text-nox-text font-medium">{formatTemp(h.temp)}°</span>
                  {h.precipitation > 0 && (
                    <span className="text-[9px] text-blue-400">{h.precipitation}mm</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer with sunrise/sunset */}
      {data.forecast && data.forecast[0]?.sunrise && data.forecast[0]?.sunset && (
        <div className="px-5 py-2 border-t border-nox-border flex items-center justify-between text-[10px] text-nox-textDim">
          <span>☀ {data.forecast[0].sunrise}</span>
          <span>{data.forecast[0].sunset} ☾</span>
        </div>
      )}
    </div>
  );
}
