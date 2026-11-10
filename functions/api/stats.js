// POST /api/stats { key } -> usage statistics for the admin "Estadísticas" view.
import { json, db, isAdminKey, madridToday, addDays, asset } from "../../cf/lib.js";
export async function onRequestPost({ request, env }){
  try{
    const b = await request.json().catch(() => ({}));
    if(!(await isAdminKey(b.key))) return json({ error: "admin" }, 403);
    const d = await db(env), today = madridToday(), d30 = addDays(today, -29), d7 = addDays(today, -6), w12 = addDays(today, -83);
    const q = (sql, ...a) => d.prepare(sql).bind(...a).all().then(r => r.results || []);
    const [daily, weekly, kpi7, kpiAll, articles, searches, email, firstDay] = await Promise.all([
      q("SELECT day, COUNT(DISTINCT uid) AS people, SUM(type='visit') AS visits, SUM(type='view') AS views FROM events WHERE day >= ? GROUP BY day ORDER BY day", d30),
      q(`SELECT date(day, '-' || ((CAST(strftime('%w', day) AS INTEGER) + 6) % 7) || ' days') AS week,
           COUNT(DISTINCT uid) AS people, SUM(type='visit') AS visits, SUM(type='view') AS views,
           SUM(type='like') AS likes, SUM(type='visit' AND src='email') AS fromEmail, COUNT(DISTINCT CASE WHEN src='email' THEN uid END) AS emailPeople
         FROM events WHERE day >= ? GROUP BY week ORDER BY week DESC`, w12),
      q("SELECT COUNT(DISTINCT uid) AS people, SUM(type='visit') AS visits, SUM(type='view') AS views, SUM(type='search') AS searches, SUM(type='like') AS likes, SUM(type='visit' AND src='email') AS fromEmail FROM events WHERE day >= ?", d7),
      q("SELECT COUNT(DISTINCT uid) AS people, SUM(type='visit') AS visits, SUM(type='view') AS views FROM events"),
      q("SELECT ref, COUNT(*) AS views, COUNT(DISTINCT uid) AS people FROM events WHERE type='view' AND day >= ? AND ref IS NOT NULL GROUP BY ref ORDER BY people DESC, views DESC LIMIT 10", d30),
      q("SELECT lower(ref) AS ref, COUNT(*) AS n, COUNT(DISTINCT uid) AS people FROM events WHERE type='search' AND day >= ? AND ref IS NOT NULL GROUP BY lower(ref) ORDER BY n DESC LIMIT 10", d30),
      q("SELECT ref, COUNT(*) AS clicks, COUNT(DISTINCT uid) AS people FROM events WHERE type='visit' AND src='email' GROUP BY ref ORDER BY ref DESC LIMIT 12"),
      q("SELECT MIN(day) AS day FROM events")
    ]);
    const news = (await asset(env, request, "/data/news.json")) || [];
    const title = id => (news.find(n => n.id === id) || {}).title || id;
    return json({
      today, since: (firstDay[0] && firstDay[0].day) || null,
      last7: kpi7[0] || {}, total: kpiAll[0] || {},
      daily, weekly,
      articles: articles.map(a => ({ ...a, title: title(a.ref) })),
      searches, email
    });
  }catch(e){ return json({ error: e.message }, 500); }
}
