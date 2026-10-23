// GET /api/votes -> { "<voterId>": { "v": { "<newsId>": 1, ... } }, ... }
const { redis } = require("./_redis");
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try{
    const flat = await redis(["HGETALL", "votes"]) || [];
    const out = {};
    for(let i = 0; i < flat.length; i += 2){ try{ out[flat[i]] = { v: JSON.parse(flat[i+1]) }; }catch(e){} }
    res.status(200).json(out);
  }catch(e){
    if(e.code === "NO_DB") return res.status(200).json({});
    res.status(500).json({ error: "No se pudieron leer los votos" });
  }
};
