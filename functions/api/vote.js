// POST /api/vote  { uid, v: { "<newsId>": 1, ... } }  -> stores this voter's likes (like-only).
import { json, asset, writeVoter } from "../../cf/lib.js";
let ids = null, idsAt = 0;
export async function onRequestPost({ request, env }){
  try{
    const body = await request.json().catch(() => ({}));
    const uid = String(body.uid || "");
    if(!/^[a-z0-9-]{12,64}$/.test(uid)) return json({ error: "uid" }, 400);
    if(!ids || Date.now() - idsAt > 60000){ ids = new Set(((await asset(env, request, "/data/news.json")) || []).map(n => n.id)); idsAt = Date.now(); }
    const v = {};
    for(const [k, val] of Object.entries(body.v || {})) if(val === 1 && ids.has(k)) v[k] = 1;
    await writeVoter(env, uid, Object.keys(v));
    return json({ ok: true, v });
  }catch(e){ return json({ error: e.message }, 500); }
}
