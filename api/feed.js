const { getCategoryFeed } = require("../lib/youtube");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const category = (req.query?.category || "Semua").toString().slice(0, 40);
    const videos = await getCategoryFeed(category);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ category, videos });
  } catch (err) {
    console.error("[/api/feed]", err);
    return res.status(500).json({ error: "Gagal mengambil feed YouTube" });
  }
};
