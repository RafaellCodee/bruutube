/* BruTube — Local Development Server */

const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  getCategoryFeed,
  searchYouTube,
  getVideoDetails,
  getChannelProfile
} = require("./lib/youtube");

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache"
  });
  res.end(JSON.stringify(data));
}

function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(err.code === "ENOENT" ? "Not Found" : "Internal Server Error");
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = reqUrl.pathname;

    if (pathname === "/api/feed") {
      const category = reqUrl.searchParams.get("category") || "Semua";
      const videos = await getCategoryFeed(category);
      return sendJson(res, 200, { category, videos });
    }

    if (pathname === "/api/search") {
      const q = (reqUrl.searchParams.get("q") || "").trim();
      if (!q) return sendJson(res, 400, { error: "Parameter 'q' wajib diisi" });
      const videos = await searchYouTube(q, "Pencarian", 20);
      return sendJson(res, 200, { query: q, videos });
    }

    if (pathname === "/api/video") {
      const id = (reqUrl.searchParams.get("id") || "").trim();
      if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
        return sendJson(res, 400, { error: "ID video YouTube tidak valid" });
      }
      const data = await getVideoDetails(id);
      return sendJson(res, 200, data);
    }

    if (pathname === "/api/channel") {
      const name = (reqUrl.searchParams.get("name") || "").trim();
      if (!name) return sendJson(res, 400, { error: "Parameter 'name' wajib diisi" });
      const profile = await getChannelProfile(name);
      return sendJson(res, 200, profile);
    }

    if (pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        runtime: "local-node",
        officialApiEnabled: Boolean(process.env.YOUTUBE_API_KEY)
      });
    }

    return serveStatic(res, pathname);
  } catch (err) {
    console.error("[BruTube Local API Error]", err);
    return sendJson(res, 500, { error: "Gagal mengambil data dari YouTube" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`BruTube server running at http://127.0.0.1:${PORT}`);
});
