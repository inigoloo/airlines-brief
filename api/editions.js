// GET /api/editions -> list of recorded editions (repo + those marked as sent from the web)
const { editions } = require("./_admin");
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try{ res.status(200).json(await editions(req)); }
  catch(e){ res.status(500).json({ error: "No se pudieron leer las ediciones" }); }
};
