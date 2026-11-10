// GET /api/config -> newsletter settings (repo config.json, overridden by newer changes saved from the web)
const { config } = require("./_admin");
module.exports = async (req, res) => {
  // Cached by Vercel's CDN for 300s so repeated visits do not spend Blob operations (the admin's browser bypasses it).
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=600");
  try{ res.status(200).json(await config(req)); }
  catch(e){ res.status(500).json({ error: "No se pudo leer la configuración" }); }
};
