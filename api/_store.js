// Vote storage in the Vercel Blob store connected to the project (BLOB_READ_WRITE_TOKEN).
// All votes live in ONE private file, votes/all.json = { "<voterId>": { "<newsId>": 1, ... }, ... },
// so reading every vote costs a single Blob operation (the free plan has few operations per month).
// The old layout (one file per voter, votes/<uid>.json) is merged into it once, the first time it is needed.
// Falls back to Upstash Redis if only those variables are configured.
const { redis } = require("./_redis");
const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const sdk = () => import("@vercel/blob");
const ALL = "votes/all.json";

let memo = null, memoAt = 0;          // short in-process cache for warm function instances
const MEMO_MS = 15000;

async function getJSON(pathname){
  const { get } = await sdk();
  try{
    const r = await get(pathname, { access: "private", useCache: false });
    if(r && r.statusCode === 200 && r.stream) return JSON.parse(await new Response(r.stream).text());
  }catch(e){}
  return null;
}
async function putJSON(pathname, obj){
  const { put } = await sdk();
  await put(pathname, JSON.stringify(obj), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
}
// One-time migration from one-file-per-voter to the single file.
async function migrate(){
  const { list } = await sdk();
  const all = {};
  let cursor;
  do {
    const page = await list({ prefix: "votes/", cursor, limit: 1000 });
    await Promise.all(page.blobs.filter(b => b.pathname !== ALL).map(async b => {
      const v = await getJSON(b.pathname);
      if(v && Object.keys(v).length) all[b.pathname.slice(6, -5)] = v;
    }));
    cursor = page.hasMore ? page.cursor : undefined;
  } while(cursor);
  await putJSON(ALL, all);
  return all;
}
async function rawAll(fresh){
  if(!fresh && memo && Date.now() - memoAt < MEMO_MS) return memo;
  const all = (await getJSON(ALL)) || await migrate();
  memo = all; memoAt = Date.now();
  return all;
}

// -> { "<voterId>": { v: { "<newsId>": 1 } } }  (same shape the portal already reads)
async function readAll(){
  if(hasBlob()){
    const all = await rawAll(false);
    const out = {};
    Object.entries(all).forEach(([uid, v]) => { out[uid] = { v }; });
    return out;
  }
  const flat = await redis(["HGETALL", "votes"]) || [];
  const out = {};
  for(let i = 0; i < flat.length; i += 2){ try{ out[flat[i]] = { v: JSON.parse(flat[i+1]) }; }catch(e){} }
  return out;
}

// Replaces this voter's likes. The page always sends the voter's full set, and re-sends it if the
// stored copy ever differs (two votes saved at the same instant), so the file heals itself.
async function writeVoter(uid, v){
  const empty = !Object.keys(v).length;
  if(hasBlob()){
    const all = { ...(await rawAll(true)) };
    if(empty) delete all[uid]; else all[uid] = v;
    await putJSON(ALL, all);
    memo = all; memoAt = Date.now();
    return;
  }
  if(empty) await redis(["HDEL", "votes", uid]);
  else await redis(["HSET", "votes", uid, JSON.stringify(v)]);
}
module.exports = { readAll, writeVoter };
