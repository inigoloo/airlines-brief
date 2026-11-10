// GET /api/votes -> { "<voterId>": { "v": { "<newsId>": 1, ... } }, ... }
const { readAll } = require("./_store");
module.exports = async (req, res) => {
  // Cached by Vercel's CDN for 60s so repeated visits do not spend Blob operations (the admin's browser bypasses it).
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
  try{
    res.status(200).json(await readAll());
  }catch(e){
    if(e.code === "NO_DB") return res.status(200).json({});
    res.status(500).json({ error: "No se pudieron leer los votos" });
  }
};
