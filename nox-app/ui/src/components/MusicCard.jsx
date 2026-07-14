import React from "react";

const PLATFORM_META = {
  spotify: { label: "Spotify", color: "#1DB954" },
  apple_music: { label: "Apple Music", color: "#FA2D48" },
  youtube: { label: "YouTube", color: "#FF0000" },
};

export default function MusicCard({ data, onOpen, onSetPlatform, locale }) {
  const {
    artist,
    title,
    album,
    cover_url,
    release_date,
    spotify_url,
    apple_music_url,
    youtube_url,
    opened_platform,
  } = data;

  const platforms = [
    { key: "spotify", url: spotify_url },
    { key: "apple_music", url: apple_music_url },
    { key: "youtube", url: youtube_url },
  ].filter((p) => p.url);

  const handleClick = (platform) => {
    const entry = platforms.find((p) => p.key === platform);
    if (!entry) return;
    onSetPlatform?.(platform);
    onOpen?.(entry.url, platform);
  };

  return (
    <div className="w-full rounded-xl overflow-hidden border border-nox-border bg-nox-surface/80 backdrop-blur-md shadow-lg">
      <div className="flex items-stretch gap-0">
        {cover_url ? (
          <img
            src={cover_url}
            alt={`${title} cover`}
            className="w-24 h-24 object-cover flex-shrink-0"
            onError={(e) => { e.target.style.display = "none"; }}
          />
        ) : (
          <div className="w-24 h-24 flex-shrink-0 bg-gradient-to-br from-nox-accent/40 to-nox-accent/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-nox-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
        )}
        <div className="flex-1 min-w-0 p-3 flex flex-col justify-center">
          <div className="text-sm font-semibold text-nox-text truncate leading-tight">
            {title || locale?.music?.unknownTitle || "Unbekannter Titel"}
          </div>
          <div className="text-xs text-nox-textLight truncate mt-0.5">
            {artist || locale?.music?.unknownArtist || "Unbekannter Künstler"}
          </div>
          {album && (
            <div className="text-[10px] text-nox-textDim truncate mt-1">
              {locale?.music?.albumLabel || "Album"}: {album}
              {release_date && ` · ${release_date}`}
            </div>
          )}
          {!album && release_date && (
            <div className="text-[10px] text-nox-textDim truncate mt-1">
              {release_date}
            </div>
          )}
        </div>
      </div>

      <div className="px-2.5 pb-2.5 pt-1.5 flex flex-wrap gap-1.5">
        {platforms.map(({ key }) => {
          const meta = PLATFORM_META[key];
          const isOpened = opened_platform === key;
          return (
            <button
              key={key}
              onClick={() => handleClick(key)}
              className={`flex-1 min-w-[70px] px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all flex items-center justify-center gap-1 ${
                isOpened
                  ? "bg-white/10 text-white ring-1 ring-white/30"
                  : "bg-nox-surface hover:bg-nox-border text-nox-text"
              }`}
              style={isOpened ? { borderColor: meta.color } : {}}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
              {meta.label}
              {isOpened && (
                <svg className="w-3 h-3 text-nox-textLight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
