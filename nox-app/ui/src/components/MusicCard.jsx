import React from "react";

const PLATFORM_META = {
  spotify: { label: "Spotify", color: "#1DB954" },
  apple_music: { label: "Apple Music", color: "#FA2D48" },
  youtube: { label: "YouTube", color: "#FF0000" },
  youtube_music: { label: "YouTube Music", color: "#FF0000" },
  amazon_music: { label: "Amazon Music", color: "#00A8E1" },
  deezer: { label: "Deezer", color: "#FF0092" },
  tidal: { label: "Tidal", color: "#000000" },
  soundcloud: { label: "SoundCloud", color: "#FF5500" },
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
    youtube_music_url,
    amazon_music_url,
    deezer_url,
    tidal_url,
    soundcloud_url,
    opened_platform,
  } = data;

  const platforms = [
    { key: "spotify", url: spotify_url },
    { key: "apple_music", url: apple_music_url },
    { key: "youtube", url: youtube_url },
    { key: "youtube_music", url: youtube_music_url },
    { key: "amazon_music", url: amazon_music_url },
    { key: "deezer", url: deezer_url },
    { key: "tidal", url: tidal_url },
    { key: "soundcloud", url: soundcloud_url },
  ].filter((p) => p.url);

  const primary = platforms.slice(0, 4);
  const secondary = platforms.slice(4);

  const handleClick = (platform) => {
    const entry = platforms.find((p) => p.key === platform);
    if (!entry) return;
    onSetPlatform?.(platform);
    onOpen?.(entry.url, platform);
  };

  const PlatformButton = ({ pKey }) => {
    const meta = PLATFORM_META[pKey];
    const isOpened = opened_platform === pKey;
    return (
      <button
        onClick={() => handleClick(pKey)}
        className={`flex-1 min-w-[70px] px-2 py-1.5 text-[10px] font-medium transition-all flex items-center justify-center gap-1 ${
          isOpened
            ? "nox-btn-primary"
            : "nox-btn-secondary"
        }`}
      >
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: isOpened ? "#06070d" : meta.color }} />
        <span style={{ color: isOpened ? "#06070d" : undefined }}>{meta.label}</span>
        {isOpened && (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: "#06070d" }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        )}
      </button>
    );
  };

  return (
    <div className="w-full nox-console-card overflow-hidden border-l-2 border-l-nox-accent">
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

      <div className="px-2.5 pt-1.5 flex flex-wrap gap-1.5">
        {primary.map((p) => (
          <PlatformButton key={p.key} pKey={p.key} />
        ))}
      </div>
      {secondary.length > 0 && (
        <div className="px-2.5 pb-2.5 pt-1.5 flex flex-wrap gap-1.5">
          {secondary.map((p) => (
            <PlatformButton key={p.key} pKey={p.key} />
          ))}
        </div>
      )}
      {secondary.length === 0 && <div className="pb-1" />}
    </div>
  );
}
