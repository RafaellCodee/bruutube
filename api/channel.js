const { getChannelProfile } = require("../lib/youtube");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const name = (req.query?.name || "").toString().trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: "Parameter 'name' wajib diisi" });
    const profile = await getChannelProfile(name);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(profile);
  } catch (err) {
    console.error("[/api/channel]", err);
    return res.status(500).json({ error: "Gagal mengambil profil channel" });
  }
};
