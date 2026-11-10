// POST /api/admin { key, op: "edition"|"deleteEdition"|"config", data } -> admin-only writes (admin key checked against its hash)
const { isAdminKey, writeJSON, saveEdition, removeEdition } = require("./_admin");
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if(req.method !== "POST") return res.status(405).json({ error: "POST" });
  try{
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if(!isAdminKey(body.key)) return res.status(403).json({ error: "admin" });
    const d = body.data || {};
    if(body.op === "edition"){
      if(!/^issue-\d{3}$/.test(String(d.id || "")) || !Array.isArray(d.newsIds)) return res.status(400).json({ error: "edition" });
      await saveEdition(d);
      return res.status(200).json({ ok: true });
    }
    if(body.op === "deleteEdition"){
      if(!/^issue-\d{3}$/.test(String(d.id || ""))) return res.status(400).json({ error: "edition" });
      await removeEdition(d.id);
      return res.status(200).json({ ok: true });
    }
    if(body.op === "config"){
      const allowed = ["threshold","minItems","maxItems","nextSend","portalUrl","cadenceDays","windowDays","audience","sendTime"];
      const c = {}; allowed.forEach(k => { if(d[k] !== undefined) c[k] = d[k]; });
      c.updatedAt = new Date().toISOString();
      await writeJSON("admin/config.json", c);
      return res.status(200).json({ ok: true, config: c });
    }
    res.status(400).json({ error: "op" });
  }catch(e){ res.status(500).json({ error: e.message }); }
};
