/* The Airlines Brief · Vercel runtime.
   Provides the small subset of the window.claude API the portal uses:
   news/sources come from static JSON in /data (updated by commits); editions and settings come from
   /api/editions and /api/config (repo files + changes saved from the web by the admin, in Vercel Blob);
   votes are read from and written to /api/votes and /api/vote (Vercel Blob). */
(function(){
  const VOTES_POLL_MS = 60000;
  const getJSON = async (url) => { const r = await fetch(url, {cache: "no-store"}); if(!r.ok) throw new Error(url + " " + r.status); return r.json(); };
  // /api/* answers are cached by the CDN for a minute or a few. The admin always reads fresh data (and so does anyone
  // right after a write), adding a unique query string that skips that cache.
  const fresh = (url) => url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();
  const isAdmin = () => { try{ return !!localStorage.getItem("brief-admin-key"); }catch(e){ return false; } };
  const api = (url) => isAdmin() ? fresh(url) : url;
  const snap = (rows) => ({ docs: rows.map(x => ({ id: x.id, exists: true, data: () => { const o = {...x}; delete o.id; return o; } })) });
  const docSnap = (obj) => ({ exists: !!obj, data: () => obj || {} });

  let uid = null;
  try { uid = localStorage.getItem("brief-uid"); } catch(e) {}
  if(!uid || !/^[a-z0-9-]{12,64}$/.test(uid)){
    uid = "v-" + (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
    try { localStorage.setItem("brief-uid", uid); } catch(e) {}
  }

  const voteListeners = new Set();
  let lastVotes = null;
  // This voter's own likes are also kept in the browser: if the shared file ever lost them (two votes saved at the
  // same instant), they are shown anyway and sent again.
  const MINE_KEY = "brief-my-votes";
  const loadMine = () => { try{ const m = JSON.parse(localStorage.getItem(MINE_KEY) || "null"); return m && typeof m === "object" ? m : null; }catch(e){ return null; } };
  const saveMine = (v) => { try{ localStorage.setItem(MINE_KEY, JSON.stringify(v || {})); }catch(e){} };
  const same = (a, b) => { const ka = Object.keys(a||{}).sort(), kb = Object.keys(b||{}).sort(); return ka.length === kb.length && ka.every((k,i) => k === kb[i]); };
  let healing = false;
  async function postVotes(v){
    const r = await fetch("/api/vote", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({ uid, v: v || {} }) });
    if(!r.ok) throw new Error("vote " + r.status);
    return r.json();
  }
  async function refreshVotes(bust){
    try{
      const v = await getJSON(bust ? fresh("/api/votes") : api("/api/votes"));
      const mine = loadMine();
      if(mine && !bust){
        const server = (v && v[uid] && v[uid].v) || {};
        if(!same(server, mine)){
          v[uid] = { v: mine };
          if(!healing){ healing = true; setTimeout(() => postVotes(mine).catch(() => {}).finally(() => { healing = false; }), 2000); }
        }
      }
      lastVotes = Object.entries(v || {}).map(([id, d]) => ({ id, v: (d && d.v) || {} }));
      voteListeners.forEach(cb => cb(snap(lastVotes)));
    }catch(e){ console.warn("votes", e); }
  }
  setInterval(() => { if(voteListeners.size && document.visibilityState === "visible") refreshVotes(); }, VOTES_POLL_MS);

  const STATIC = { news: "/data/news.json", sources: "/data/sources.json", editions: "/api/editions" };
  const live = { editions: new Set(), config: new Set() };
  const reload = () => {
    getJSON(fresh("/api/editions")).then(rows => live.editions.forEach(cb => cb(snap(rows)))).catch(() => {});
    getJSON(fresh("/api/config")).then(c => live.config.forEach(cb => cb(docSnap(c)))).catch(() => {});
  };
  const adminKey = () => { try{ return localStorage.getItem("brief-admin-key") || ""; }catch(e){ return ""; } };
  async function adminWrite(op, data){
    const r = await fetch("/api/admin", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({ key: adminKey(), op, data }) });
    if(!r.ok){ const e = new Error("admin " + r.status); e.code = r.status === 403 ? "forbidden" : "failed"; throw e; }
    reload();
  }
  const db = {
    collection(name){
      return {
        onSnapshot(cb, err){
          if(name === "votes"){ voteListeners.add(cb); if(lastVotes) cb(snap(lastVotes)); else refreshVotes(); return () => voteListeners.delete(cb); }
          if(name === "editions") live.editions.add(cb);
          if(STATIC[name]) getJSON(STATIC[name].startsWith("/api/") ? api(STATIC[name]) : STATIC[name]).then(rows => cb(snap(rows))).catch(e => err && err(e));
          else cb(snap([]));
          return () => {};
        },
        add(){ return Promise.reject(new Error("read-only")); }
      };
    },
    doc(path){
      return {
        onSnapshot(cb, err){
          if(path === "config/settings"){ live.config.add(cb); getJSON(api("/api/config")).then(c => cb(docSnap(c))).catch(e => err && err(e)); }
          else cb(docSnap(null));
          return () => {};
        },
        async set(data){
          const ed = /^editions\/(issue-\d{3})$/.exec(path);
          if(ed) return adminWrite("edition", { id: ed[1], ...data });
          if(path === "config/settings") return adminWrite("config", data);
          const m = /^votes\/(.+)$/.exec(path);
          if(!m || m[1] !== uid) throw new Error("read-only");
          const v = (data && data.v) || {};
          saveMine(v);
          await postVotes(v);
        },
        update(){ return Promise.reject(new Error("read-only")); }
      };
    }
  };
  const user = { id: async () => uid, can: async () => true, canEdit: async () => false };
  window.claude = { use: async (name) => name === "db" ? db : name === "user" ? user : Promise.reject(new Error("unavailable")) };
})();
