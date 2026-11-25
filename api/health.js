module.exports = function handler(req, res) {
  return res.status(200).json({
    ok: true,
    runtime: "vercel-serverless",
    officialApiEnabled: Boolean(process.env.YOUTUBE_API_KEY)
  });
};
