// GET /api/editions -> list of recorded editions (repo + those marked as sent from the web)
const { editions } = require("./_admin");
module.exports = async (req, res) => {
  // Cached by Vercel's CDN for 300s so repeated visits do not spend Blob operations (the admin's browser bypasses it).
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=600");
  try{ res.status(200).json(await editions(req)); }
  catch(e){ res.status(500).json({ error: "No se pudieron leer las ediciones" }); }
};
