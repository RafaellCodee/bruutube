window.BRUTUBE_CATEGORIES = [
  "Semua",
  "Musik",
  "Gaming",
  "Teknologi",
  "Film & Animasi",
  "Berita",
  "Olahraga",
  "Edukasi",
  "Podcast",
  "Otomotif",
  "Kuliner"
];

/**
 * Parse a YouTube URL or 11-char video ID.
 */
window.parseYouTubeId = function parseYouTubeId(input) {
  if (!input) return null;
  const trimmed = input.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.slice(1).split("/")[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtube-nocookie.com"
    ) {
      if (url.searchParams.has("v")) {
        const id = url.searchParams.get("v");
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }
      const match = url.pathname.match(/^\/(embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/);
      if (match) return match[2];
    }
  } catch {
    return null;
  }
  return null;
};

/**
 * Fallback SVG thumbnail when an image fails to load.
 */
window.makeFallbackThumb = function makeFallbackThumb(title = "BruTube") {
  const safe = String(title).slice(0, 32).replace(/[<>&"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <rect width="640" height="360" fill="#18181b"/>
    <rect x="276" y="136" width="88" height="60" rx="6" fill="#ff3b30" stroke="#ffe500" stroke-width="4"/>
    <polygon points="310,152 338,166 310,180" fill="#ffffff"/>
    <text x="320" y="236" fill="#f4f4ef" font-family="sans-serif" font-size="18" font-weight="700" text-anchor="middle">${safe}</text>
  </svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
};
