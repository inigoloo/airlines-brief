// Admin data kept in the private Vercel Blob store: editions recorded from the web and settings changes.
// Repo files (data/editions.json, data/config.json) stay the base; the scheduled task keeps writing those.
const crypto = require("crypto");
const ADMIN_HASH = "dd5000a19b9bbdeea6068b24f3980c88c3f54f34894801566dfe483f1791ef58"; // sha256 of the admin key
const sdk = () => import("@vercel/blob");
const isAdminKey = k => typeof k === "string" && k.length > 0 && crypto.createHash("sha256").update(k).digest("hex") === ADMIN_HASH;

async function readJSON(pathname){
  const { get } = await sdk();
  try{
    const r = await get(pathname, { access: "private", useCache: false });
    if(r && r.statusCode === 200 && r.stream) return JSON.parse(await new Response(r.stream).text());
  }catch(e){}
  return null;
}
async function writeJSON(pathname, obj){
  const { put } = await sdk();
  await put(pathname, JSON.stringify(obj), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
}
async function repo(req, file){
  const proto = req.headers["x-forwarded-proto"] || "https";
  const r = await fetch(`${proto}://${req.headers.host}/data/${file}`, { cache: "no-store" });
  return r.ok ? r.json() : null;
}
// Editions recorded from the web live in ONE private file, admin/editions.json (an array), so reading them costs one
// Blob operation. Older per-edition files (admin/editions/<id>.json) are merged into it once.
async function adminEditions(){
  const all = await readJSON("admin/editions.json");
  if(Array.isArray(all)) return all;
  const { list } = await sdk();
  const page = await list({ prefix: "admin/editions/", limit: 1000 });
  const rows = (await Promise.all(page.blobs.map(b => readJSON(b.pathname)))).filter(e => e && e.id);
  await writeJSON("admin/editions.json", rows);
  return rows;
}
async function saveEdition(e){
  const rows = (await adminEditions()).filter(x => x.id !== e.id);
  rows.push(e);
  await writeJSON("admin/editions.json", rows);
}
async function removeEdition(id){
  const rows = await adminEditions();
  await writeJSON("admin/editions.json", rows.filter(x => x.id !== id));
}
async function editions(req){
  const base = (await repo(req, "editions.json")) || [];
  const byId = new Map(base.map(e => [e.id, e]));
  (await adminEditions()).forEach(e => { if(e && e.id && !byId.has(e.id)) byId.set(e.id, e); });
  return [...byId.values()].sort((a, b) => String(a.sentAt || "").localeCompare(String(b.sentAt || "")));
}
async function config(req){
  const base = (await repo(req, "config.json")) || {};
  const over = await readJSON("admin/config.json");
  // The newer of the two wins (the scheduled task stamps updatedAt in the repo file; the web stamps the override).
  const cfg = (over && String(over.updatedAt || "") > String(base.updatedAt || "")) ? { ...base, ...over } : { ...base };
  // Sends are manual now: if the scheduled day has passed (and nothing moved it), the next edition is the next
  // scheduled day from today (Madrid time), so the window and the issue date never stay stuck in the past.
  if(/^\d{4}-\d{2}-\d{2}$/.test(cfg.nextSend || "")){
    const today = madridToday(), step = +cfg.cadenceDays || 7;
    while(cfg.nextSend < today) cfg.nextSend = addDays(cfg.nextSend, step);
  }
  return cfg;
}
const madridToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
module.exports = { isAdminKey, editions, config, writeJSON, saveEdition, removeEdition, repo, madridToday, addDays };
