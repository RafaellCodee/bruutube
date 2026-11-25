/* BruTube — Shared YouTube Data Service (Local + Vercel Serverless) */

try {
  const { Agent, setGlobalDispatcher } = require("undici");
  setGlobalDispatcher(new Agent({ maxHeaderSize: 65536 }));
} catch {
  // Ignore if undici is not directly resolvable
}

const YouTube = require("youtube-sr").default;
const yts = require("yt-search");

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();
const embedCheckCache = new Map();

const CATEGORY_QUERIES = {
  "Semua": [
    "gadget review teknologi indonesia terbaru",
    "podcast indonesia menarik terbaru",
    "edukasi sains teknologi menarik indonesia",
    "kuliner street food indonesia terbaru"
  ],
  "Populer": [
    "trending youtube indonesia terbaru",
    "viral indonesia terbaru vlog"
  ],
  "Musik": ["live acoustic cover indonesia", "lofi hip hop beats study"],
  "Gaming": ["gameplay indonesia terbaru", "review game terbaru indonesia"],
  "Teknologi": ["gadget review indonesia terbaru", "tutorial coding web indonesia"],
  "Film & Animasi": ["official trailer film terbaru", "short animated film 4k"],
  "Berita": ["berita terkini indonesia hari ini"],
  "Olahraga": ["analisis sepak bola terbaru indonesia", "olahraga fitness workout"],
  "Edukasi": ["edukasi sains sejarah menarik indonesia"],
  "Podcast": ["podcast indonesia terbaru full"],
  "Otomotif": ["review mobil motor indonesia terbaru"],
  "Kuliner": ["kuliner street food indonesia enak"]
};

const CHANNEL_COLORS = [
  "#e11d48", "#2563eb", "#7c3aed", "#059669",
  "#d97706", "#0284c7", "#db2777", "#4f46e5", "#ea580c"
];

function colorForChannel(name = "") {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return CHANNEL_COLORS[Math.abs(hash) % CHANNEL_COLORS.length];
}

function makeHandle(name = "") {
  const clean = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return "@" + (clean || "youtubechannel");
}

function parseIsoDuration(iso = "") {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(min).padStart(2, "0")}:${ss}`;
  return `${min}:${ss}`;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data) {
  cache.set(key, { ts: Date.now(), data });
  if (cache.size > 150) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

/* --------------------------------------------------------------------------
   Path 1: Official YouTube Data API v3 (when YOUTUBE_API_KEY env var is set)
   -------------------------------------------------------------------------- */
async function searchViaOfficialAPI(query, category = "YouTube", limit = 20) {
  const apiKey = (process.env.YOUTUBE_API_KEY || "").trim();
  if (!apiKey) return null;

  const searchUrl =
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&regionCode=ID&maxResults=${Math.min(25, limit)}&q=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`;

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) throw new Error(`YouTube API search error: ${searchRes.status}`);
  const searchData = await searchRes.json();
  const items = (searchData.items || []).filter((i) => i.id?.videoId);
  if (items.length === 0) return [];

  const videoIds = items.map((i) => i.id.videoId).join(",");
  const channelIds = [...new Set(items.map((i) => i.snippet?.channelId).filter(Boolean))].join(",");

  const [vidRes, chRes] = await Promise.all([
    fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${encodeURIComponent(videoIds)}&key=${encodeURIComponent(apiKey)}`),
    channelIds
      ? fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${encodeURIComponent(channelIds)}&key=${encodeURIComponent(apiKey)}`)
      : Promise.resolve(null)
  ]);

  const vidMap = new Map();
  if (vidRes.ok) {
    const vd = await vidRes.json();
    (vd.items || []).forEach((v) => vidMap.set(v.id, v));
  }

  const chMap = new Map();
  if (chRes && chRes.ok) {
    const cd = await chRes.json();
    (cd.items || []).forEach((c) => chMap.set(c.id, c));
  }

  return items.map((item) => {
    const vid = item.id.videoId;
    const sn = item.snippet || {};
    const vInfo = vidMap.get(vid);
    const cInfo = chMap.get(sn.channelId);
    const channelName = sn.channelTitle || "YouTube Channel";
    const views = Number(vInfo?.statistics?.viewCount) || 0;
    const likes = Number(vInfo?.statistics?.likeCount) || Math.max(10, Math.floor(views * 0.035));
    const subsCount = Number(cInfo?.statistics?.subscriberCount) || 0;
    const subsText = subsCount >= 1_000_000
      ? `${(subsCount / 1_000_000).toFixed(1).replace(".", ",")} Jt subscriber`
      : subsCount >= 1_000
        ? `${(subsCount / 1_000).toFixed(0)} Rb subscriber`
        : "YouTube Channel";

    return {
      id: "yt-" + vid,
      youtubeId: vid,
      title: sn.title || "Tanpa Judul",
      channel: channelName,
      channelHandle: cInfo?.snippet?.customUrl || makeHandle(channelName),
      channelAvatar: cInfo?.snippet?.thumbnails?.default?.url || "",
      channelVerified: subsCount >= 100_000,
      channelUrl: sn.channelId ? `https://www.youtube.com/channel/${sn.channelId}` : "",
      channelColor: colorForChannel(channelName),
      subscribers: subsText,
      views,
      uploadedAt: sn.publishedAt ? new Date(sn.publishedAt).toLocaleDateString("id-ID") : "YouTube",
      duration: parseIsoDuration(vInfo?.contentDetails?.duration || ""),
      category,
      type: "youtube",
      thumb: sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
      likes,
      description: sn.description || ""
    };
  });
}

/* --------------------------------------------------------------------------
   Path 2: Zero-key youtube-sr + yt-search + oEmbed embeddability check
   -------------------------------------------------------------------------- */
function normalizeSRVideo(v, category = "YouTube") {
  const channelName = v.channel?.name || "YouTube Channel";
  const channelAvatar = typeof v.channel?.icon === "string"
    ? v.channel.icon
    : (v.channel?.icon?.url || (typeof v.channel?.iconURL === "function" ? v.channel.iconURL() : ""));
  const thumb = typeof v.thumbnail === "string"
    ? v.thumbnail
    : (v.thumbnail?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`);

  return {
    id: "yt-" + v.id,
    youtubeId: v.id,
    title: v.title || "Tanpa Judul",
    channel: channelName,
    channelHandle: makeHandle(channelName),
    channelAvatar,
    channelVerified: Boolean(v.channel?.verified),
    channelUrl: v.channel?.url || "",
    channelColor: colorForChannel(channelName),
    subscribers: "YouTube Channel",
    views: Number(v.views) || 0,
    uploadedAt: v.uploadedAt || "Baru-baru ini",
    duration: v.durationFormatted || "",
    category,
    type: "youtube",
    thumb,
    likes: Math.max(10, Math.floor((Number(v.views) || 1000) * 0.035)),
    description: v.description || ""
  };
}

async function isEmbeddable(videoId) {
  const cached = embedCheckCache.get(videoId);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) {
    return cached.ok;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    const ok = res.ok;
    embedCheckCache.set(videoId, { ok, ts: Date.now() });
    return ok;
  } catch {
    return true;
  }
}

async function filterEmbeddableVideos(videos, limit = 20) {
  const checks = await Promise.all(
    videos.map(async (v) => ({ video: v, ok: await isEmbeddable(v.youtubeId) }))
  );
  return checks.filter((c) => c.ok).map((c) => c.video).slice(0, limit);
}

async function searchYouTube(query, category = "YouTube", limit = 20) {
  const cacheKey = `sr:${category}:${query}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Prefer official YouTube Data API v3 if YOUTUBE_API_KEY is configured
  if (process.env.YOUTUBE_API_KEY) {
    try {
      const apiVideos = await searchViaOfficialAPI(query, category, limit);
      if (apiVideos && apiVideos.length > 0) {
        setCached(cacheKey, apiVideos);
        return apiVideos;
      }
    } catch (err) {
      console.warn("[YouTube API v3 fallback]", err.message);
    }
  }

  let raw = [];
  try {
    const results = await YouTube.search(query, {
      limit: Math.min(20, limit),
      type: "video"
    });
    raw = (results || [])
      .filter((v) => v && v.id && !v.live)
      .map((v) => normalizeSRVideo(v, category));
  } catch (err) {
    console.warn("[youtube-sr fallback to yt-search]", err.message);
    const fallback = await yts({ query, hl: "id", gl: "ID" });
    raw = (fallback.videos || [])
      .filter((v) => v && v.videoId)
      .slice(0, limit)
      .map((v) => ({
        id: "yt-" + v.videoId,
        youtubeId: v.videoId,
        title: v.title || "Tanpa Judul",
        channel: v.author?.name || "YouTube Channel",
        channelHandle: makeHandle(v.author?.name || ""),
        channelAvatar: "",
        channelVerified: false,
        channelUrl: v.author?.url || "",
        channelColor: colorForChannel(v.author?.name || ""),
        subscribers: "YouTube Channel",
        views: Number(v.views) || 0,
        uploadedAt: v.ago || "Baru-baru ini",
        duration: v.timestamp || "",
        category,
        type: "youtube",
        thumb: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        likes: Math.max(10, Math.floor((Number(v.views) || 1000) * 0.035)),
        description: v.description || ""
      }));
  }

  const embeddable = await filterEmbeddableVideos(raw, limit);
  if (embeddable.length > 0) setCached(cacheKey, embeddable);
  return embeddable;
}

async function getCategoryFeed(category = "Semua") {
  const cacheKey = `feed:${category}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const queries = CATEGORY_QUERIES[category] || [`${category} indonesia terbaru`];
  const perQuery = Math.ceil(20 / queries.length);
  const batches = await Promise.all(
    queries.map((q) => searchYouTube(q, category, perQuery).catch(() => []))
  );

  const seen = new Set();
  const merged = [];
  const maxLen = Math.max(...batches.map((b) => b.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const batch of batches) {
      const v = batch[i];
      if (v && !seen.has(v.youtubeId)) {
        seen.add(v.youtubeId);
        merged.push(v);
      }
    }
  }

  const finalFeed = merged.slice(0, 20);
  if (finalFeed.length > 0) setCached(cacheKey, finalFeed);
  return finalFeed;
}

async function getVideoDetails(videoId) {
  const cacheKey = `video:${videoId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let video = null;
  try {
    const info = await YouTube.getVideo(`https://www.youtube.com/watch?v=${videoId}`);
    if (info && info.id) {
      video = normalizeSRVideo(info, "YouTube");
      if (info.channel?.subscribers) video.subscribers = String(info.channel.subscribers);
      if (info.likes) video.likes = Number(info.likes) || video.likes;
    }
  } catch {
    // Fallback to yt-search
  }

  if (!video) {
    const info = await yts({ videoId });
    video = {
      id: "yt-" + videoId,
      youtubeId: videoId,
      title: info.title || `Video YouTube (${videoId})`,
      channel: info.author?.name || "YouTube Channel",
      channelHandle: makeHandle(info.author?.name || ""),
      channelAvatar: "",
      channelVerified: false,
      channelUrl: info.author?.url || "",
      channelColor: colorForChannel(info.author?.name || ""),
      subscribers: "YouTube Channel",
      views: Number(info.views) || 0,
      uploadedAt: info.ago || info.uploadDate || "YouTube",
      duration: info.timestamp || "",
      category: "YouTube",
      type: "youtube",
      thumb: info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      likes: Math.max(10, Math.floor((Number(info.views) || 1000) * 0.035)),
      description: info.description || ""
    };
  }

  const cleanTitle = (video.title || "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4)
    .join(" ");
  const relatedQuery = cleanTitle || video.channel || "teknologi indonesia";

  let related = [];
  try {
    const relResults = await searchYouTube(relatedQuery, "YouTube", 14);
    related = relResults.filter((r) => r.youtubeId !== videoId).slice(0, 12);
    if (related.length === 0 && video.channel) {
      const chResults = await searchYouTube(video.channel, "YouTube", 12);
      related = chResults.filter((r) => r.youtubeId !== videoId).slice(0, 10);
    }
  } catch {
    related = [];
  }

  const payload = { video, related };
  setCached(cacheKey, payload);
  return payload;
}

async function getChannelProfile(channelName) {
  const cacheKey = `channel:${channelName.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const videos = await searchYouTube(channelName, "Channel", 20);
  const matching = videos.filter(
    (v) => v.channel.toLowerCase().includes(channelName.toLowerCase()) ||
           channelName.toLowerCase().includes(v.channel.toLowerCase())
  );
  const finalVideos = matching.length >= 4 ? matching : videos;
  const primary = finalVideos[0];

  const profile = {
    name: primary?.channel || channelName,
    handle: primary?.channelHandle || makeHandle(channelName),
    avatar: primary?.channelAvatar || "",
    verified: Boolean(primary?.channelVerified),
    color: primary?.channelColor || colorForChannel(channelName),
    subscribers: primary?.subscribers || "YouTube Channel",
    videoCount: finalVideos.length,
    videos: finalVideos
  };

  if (finalVideos.length > 0) setCached(cacheKey, profile);
  return profile;
}

module.exports = {
  getCategoryFeed,
  searchYouTube,
  getVideoDetails,
  getChannelProfile
};
