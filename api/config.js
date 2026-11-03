// GET /api/config -> newsletter settings (repo config.json, overridden by newer changes saved from the web)
const { config } = require("./_admin");
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try{ res.status(200).json(await config(req)); }
  catch(e){ res.status(500).json({ error: "No se pudo leer la configuración" }); }
};
