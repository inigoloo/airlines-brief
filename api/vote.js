// POST /api/vote  { uid, v: { "<newsId>": 1, ... } }  -> stores this voter's likes (like-only).
const { redis } = require("./_redis");
let ids = null, idsAt = 0;
async function newsIds(req){
  if(ids && Date.now() - idsAt < 60000) return ids;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const r = await fetch(`${proto}://${req.headers.host}/data/news.json`, { cache: "no-store" });
  ids = new Set((await r.json()).map(n => n.id)); idsAt = Date.now(); return ids;
}
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if(req.method !== "POST") return res.status(405).json({ error: "POST" });
  try{
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const uid = String(body.uid || "");
    if(!/^[a-z0-9-]{12,64}$/.test(uid)) return res.status(400).json({ error: "uid" });
    const known = await newsIds(req);
    const v = {};
    for(const [k, val] of Object.entries(body.v || {})) if(val === 1 && known.has(k)) v[k] = 1;
    if(Object.keys(v).length) await redis(["HSET", "votes", uid, JSON.stringify(v)]);
    else await redis(["HDEL", "votes", uid]);
    res.status(200).json({ ok: true, v });
  }catch(e){
    res.status(e.code === "NO_DB" ? 503 : 500).json({ error: e.message });
  }
};
