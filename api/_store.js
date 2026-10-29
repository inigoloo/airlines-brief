// Vote storage. Uses the Vercel Blob store connected to the project (BLOB_READ_WRITE_TOKEN):
// one private JSON file per anonymous voter at votes/<uid>.json.
// Falls back to Upstash Redis if only those variables are configured.
const { redis } = require("./_redis");
const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const sdk = () => import("@vercel/blob");

async function readAll(){
  if(hasBlob()){
    const { list, get } = await sdk();
    const out = {};
    let cursor;
    do {
      const page = await list({ prefix: "votes/", cursor, limit: 1000 });
      await Promise.all(page.blobs.map(async b => {
        const uid = b.pathname.slice(6, -5);
        try{
          const r = await get(b.pathname, { access: "private", useCache: false });
          if(r && r.statusCode === 200 && r.stream){ out[uid] = { v: JSON.parse(await new Response(r.stream).text()) }; }
        }catch(e){}
      }));
      cursor = page.hasMore ? page.cursor : undefined;
    } while(cursor);
    return out;
  }
  const flat = await redis(["HGETALL", "votes"]) || [];
  const out = {};
  for(let i = 0; i < flat.length; i += 2){ try{ out[flat[i]] = { v: JSON.parse(flat[i+1]) }; }catch(e){} }
  return out;
}

async function writeVoter(uid, v){
  const empty = !Object.keys(v).length;
  if(hasBlob()){
    const { put, del } = await sdk();
    const path = `votes/${uid}.json`;
    if(empty){ try{ await del(path); }catch(e){} return; }
    await put(path, JSON.stringify(v), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
    return;
  }
  if(empty) await redis(["HDEL", "votes", uid]);
  else await redis(["HSET", "votes", uid, JSON.stringify(v)]);
}
module.exports = { readAll, writeVoter };
