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
async function editions(req){
  const base = (await repo(req, "editions.json")) || [];
  const byId = new Map(base.map(e => [e.id, e]));
  const { list } = await sdk();
  const page = await list({ prefix: "admin/editions/", limit: 1000 });
  await Promise.all(page.blobs.map(async b => { const e = await readJSON(b.pathname); if(e && e.id && !byId.has(e.id)) byId.set(e.id, e); }));
  return [...byId.values()].sort((a, b) => String(a.sentAt || "").localeCompare(String(b.sentAt || "")));
}
async function config(req){
  const base = (await repo(req, "config.json")) || {};
  const over = await readJSON("admin/config.json");
  // The newer of the two wins (the scheduled task stamps updatedAt in the repo file; the web stamps the override).
  if(over && String(over.updatedAt || "") > String(base.updatedAt || "")) return { ...base, ...over };
  return base;
}
module.exports = { isAdminKey, editions, config, writeJSON };
