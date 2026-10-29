// GET /api/votes -> { "<voterId>": { "v": { "<newsId>": 1, ... } }, ... }
const { readAll } = require("./_store");
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try{
    res.status(200).json(await readAll());
  }catch(e){
    if(e.code === "NO_DB") return res.status(200).json({});
    res.status(500).json({ error: "No se pudieron leer los votos" });
  }
};
