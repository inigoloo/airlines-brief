// The Airlines Brief · shared code for the Cloudflare Pages Functions (functions/api/*).
// Storage: Cloudflare D1 (binding DB). Static files (news, config, photos) are read through the ASSETS binding.
export const ADMIN_HASH = "dd5000a19b9bbdeea6068b24f3980c88c3f54f34894801566dfe483f1791ef58"; // sha256 of the admin key

export const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

export async function isAdminKey(k){
  if(typeof k !== "string" || !k) return false;
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(k));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("") === ADMIN_HASH;
}

let ready = false;
export async function db(env){
  if(!ready){
    await env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS votes (uid TEXT NOT NULL, news_id TEXT NOT NULL, PRIMARY KEY (uid, news_id))"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS editions (id TEXT PRIMARY KEY, sent_at TEXT, data TEXT NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS events (ts TEXT NOT NULL, day TEXT NOT NULL, uid TEXT NOT NULL, type TEXT NOT NULL, ref TEXT, src TEXT)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS events_day ON events (day, type)")
    ]);
    ready = true;
  }
  return env.DB;
}

export async function asset(env, request, path){
  const r = await env.ASSETS.fetch(new URL(path, request.url));
  return r.ok ? r.json() : null;
}
export async function assetExists(env, request, path){
  const r = await env.ASSETS.fetch(new Request(new URL(path, request.url), { method: "HEAD" }));
  return r.ok;
}

// -> { "<voterId>": { v: { "<newsId>": 1 } } }
export async function readVotes(env){
  const { results } = await (await db(env)).prepare("SELECT uid, news_id FROM votes").all();
  const out = {};
  (results || []).forEach(r => { (out[r.uid] = out[r.uid] || { v: {} }).v[r.news_id] = 1; });
  return out;
}
export async function writeVoter(env, uid, ids){
  const d = await db(env);
  await d.batch([
    d.prepare("DELETE FROM votes WHERE uid = ?").bind(uid),
    ...ids.map(id => d.prepare("INSERT OR IGNORE INTO votes (uid, news_id) VALUES (?, ?)").bind(uid, id))
  ]);
}

export async function editions(env, request){
  const base = (await asset(env, request, "/data/editions.json")) || [];
  const byId = new Map(base.map(e => [e.id, e]));
  const { results } = await (await db(env)).prepare("SELECT data FROM editions").all();
  (results || []).forEach(r => { try{ const e = JSON.parse(r.data); if(e && e.id && !byId.has(e.id)) byId.set(e.id, e); }catch(x){} });
  return [...byId.values()].sort((a, b) => String(a.sentAt || "").localeCompare(String(b.sentAt || "")));
}
export async function saveEdition(env, e){
  await (await db(env)).prepare("INSERT INTO editions (id, sent_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET sent_at = excluded.sent_at, data = excluded.data")
    .bind(e.id, e.sentAt || "", JSON.stringify(e)).run();
}
export async function removeEdition(env, id){
  await (await db(env)).prepare("DELETE FROM editions WHERE id = ?").bind(id).run();
}

export const madridToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export async function config(env, request){
  const base = (await asset(env, request, "/data/config.json")) || {};
  const row = await (await db(env)).prepare("SELECT value FROM settings WHERE key = 'config'").first();
  let over = null; try{ over = row ? JSON.parse(row.value) : null; }catch(e){}
  // The newer of the two wins (the scheduled task stamps updatedAt in the repo file; the web stamps the override).
  const cfg = (over && String(over.updatedAt || "") > String(base.updatedAt || "")) ? { ...base, ...over } : { ...base };
  // Sends are manual: once the scheduled day has passed, the next edition is the next scheduled day from today (Madrid).
  if(/^\d{4}-\d{2}-\d{2}$/.test(cfg.nextSend || "")){
    const today = madridToday(), step = +cfg.cadenceDays || 7;
    while(cfg.nextSend < today) cfg.nextSend = addDays(cfg.nextSend, step);
  }
  return cfg;
}
export async function saveConfig(env, c){
  await (await db(env)).prepare("INSERT INTO settings (key, value) VALUES ('config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(c)).run();
}
