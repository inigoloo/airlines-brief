// POST /api/hit { uid, type: "visit"|"view"|"search"|"like", ref?, src? } -> records one anonymous usage event.
// uid is the same anonymous id the portal already uses for likes (no names, no emails). The admin's own use is not sent.
import { json, db, madridToday } from "../../cf/lib.js";
const TYPES = new Set(["visit", "view", "search", "like"]);
export async function onRequestPost({ request, env }){
  try{
    // Automated clients (crawlers, link previews, scripts) are ignored.
    const ua = request.headers.get("user-agent") || "";
    if(!ua || /bot|crawl|spider|slurp|headless|preview|prerender|lighthouse|pagespeed|facebookexternalhit|embedly|skypeuripreview|teams|whatsapp|telegram|slack|discord|linkedin|google-inspectiontool|bingpreview|phantom|puppeteer|playwright|uptime|monitor|curl|wget|python|axios|node-fetch/i.test(ua)) return json({ ok: true, ignored: true });
    const b = await request.json().catch(() => ({}));
    const uid = String(b.uid || ""), type = String(b.type || "");
    if(!/^[a-z0-9-]{12,64}$/.test(uid) || !TYPES.has(type)) return json({ error: "bad" }, 400);
    const ref = b.ref == null ? null : String(b.ref).trim().slice(0, 120) || null;
    const src = b.src === "email" ? "email" : null;
    await (await db(env)).prepare("INSERT INTO events (ts, day, uid, type, ref, src) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(new Date().toISOString(), madridToday(), uid, type, ref, src).run();
    return json({ ok: true });
  }catch(e){ return json({ error: e.message }, 500); }
}
