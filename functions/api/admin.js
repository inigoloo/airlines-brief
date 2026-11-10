// POST /api/admin { key, op: "edition"|"deleteEdition"|"config", data } -> admin-only writes (admin key checked against its hash)
import { json, isAdminKey, saveEdition, removeEdition, saveConfig } from "../../cf/lib.js";
export async function onRequestPost({ request, env }){
  try{
    const body = await request.json().catch(() => ({}));
    if(!(await isAdminKey(body.key))) return json({ error: "admin" }, 403);
    const d = body.data || {};
    if(body.op === "edition"){
      if(!/^issue-\d{3}$/.test(String(d.id || "")) || !Array.isArray(d.newsIds)) return json({ error: "edition" }, 400);
      await saveEdition(env, d);
      return json({ ok: true });
    }
    if(body.op === "deleteEdition"){
      if(!/^issue-\d{3}$/.test(String(d.id || ""))) return json({ error: "edition" }, 400);
      await removeEdition(env, d.id);
      return json({ ok: true });
    }
    if(body.op === "config"){
      const allowed = ["threshold","minItems","maxItems","nextSend","portalUrl","cadenceDays","windowDays","audience","sendTime"];
      const c = {}; allowed.forEach(k => { if(d[k] !== undefined) c[k] = d[k]; });
      c.updatedAt = new Date().toISOString();
      await saveConfig(env, c);
      return json({ ok: true, config: c });
    }
    return json({ error: "op" }, 400);
  }catch(e){ return json({ error: e.message }, 500); }
}
