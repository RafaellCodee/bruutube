const { getVideoDetails } = require("../lib/youtube");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const id = (req.query?.id || "").toString().trim();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
      return res.status(400).json({ error: "ID video YouTube tidak valid" });
    }
    const data = await getVideoDetails(id);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(data);
  } catch (err) {
    console.error("[/api/video]", err);
    return res.status(500).json({ error: "Gagal mengambil detail video" });
  }
};
