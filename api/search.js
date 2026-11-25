const { searchYouTube } = require("../lib/youtube");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const q = (req.query?.q || "").toString().trim().slice(0, 120);
    if (!q) return res.status(400).json({ error: "Parameter 'q' wajib diisi" });
    const videos = await searchYouTube(q, "Pencarian", 20);
    res.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=300");
    return res.status(200).json({ query: q, videos });
  } catch (err) {
    console.error("[/api/search]", err);
    return res.status(500).json({ error: "Gagal mencari video di YouTube" });
  }
};
