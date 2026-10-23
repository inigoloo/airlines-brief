/* The Airlines Brief · Vercel runtime.
   Provides the small subset of the window.claude API the portal uses:
   news/sources/editions/config come from static JSON in /data (updated by commits),
   votes are read from and written to /api/votes and /api/vote (Upstash Redis). */
(function(){
  const VOTES_POLL_MS = 30000;
  const getJSON = async (url) => { const r = await fetch(url, {cache: "no-store"}); if(!r.ok) throw new Error(url + " " + r.status); return r.json(); };
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
  async function refreshVotes(){
    try{
      const v = await getJSON("/api/votes");
      lastVotes = Object.entries(v || {}).map(([id, d]) => ({ id, v: (d && d.v) || {} }));
      voteListeners.forEach(cb => cb(snap(lastVotes)));
    }catch(e){ console.warn("votes", e); }
  }
  setInterval(() => { if(voteListeners.size && document.visibilityState === "visible") refreshVotes(); }, VOTES_POLL_MS);

  const STATIC = { news: "/data/news.json", sources: "/data/sources.json", editions: "/data/editions.json" };
  const db = {
    collection(name){
      return {
        onSnapshot(cb, err){
          if(name === "votes"){ voteListeners.add(cb); if(lastVotes) cb(snap(lastVotes)); else refreshVotes(); return () => voteListeners.delete(cb); }
          if(STATIC[name]) getJSON(STATIC[name]).then(rows => cb(snap(rows))).catch(e => err && err(e));
          else cb(snap([]));
          return () => {};
        },
        add(){ return Promise.reject(new Error("read-only")); }
      };
    },
    doc(path){
      return {
        onSnapshot(cb, err){
          if(path === "config/settings") getJSON("/data/config.json").then(c => cb(docSnap(c))).catch(e => err && err(e));
          else cb(docSnap(null));
          return () => {};
        },
        async set(data){
          const m = /^votes\/(.+)$/.exec(path);
          if(!m || m[1] !== uid) throw new Error("read-only");
          const r = await fetch("/api/vote", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({ uid, v: (data && data.v) || {} }) });
          if(!r.ok) throw new Error("vote " + r.status);
          refreshVotes();
        },
        update(){ return Promise.reject(new Error("read-only")); }
      };
    }
  };
  const user = { id: async () => uid, can: async () => true, canEdit: async () => false };
  window.claude = { use: async (name) => name === "db" ? db : name === "user" ? user : Promise.reject(new Error("unavailable")) };
})();
