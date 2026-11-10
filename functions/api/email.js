// GET /api/email -> the next edition, ready for Outlook: { issue, sendDate, subject, html, images: [absolute urls], items: [...] }
// Same selection rules as the "Próxima edición" view of the web (index.html: selection / emailHTML) and tools/brief.py.
// Used by the weekly script on the editor's computer, which builds an Outlook draft with the images embedded.
import { json, editions, config, asset, assetExists, readVotes, madridToday, addDays } from "../../cf/lib.js";

const CATS = { FIN: "Finanzas", STR: "Estrategia", CUS: "Cliente", NET: "Red", FLT: "Flota" };
const MONTHS = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = iso => { if(!iso) return "—"; const [y, m, d] = iso.slice(0, 10).split("-"); return `${d} ${MONTHS[+m - 1]} ${y}`; };
const isValid = n => n && n.title && n.source && /^https:\/\/\S+$/.test(n.url || "") && /^\d{4}-\d{2}-\d{2}$/.test(n.publishedAt || "");
const tier = n => (n.aiScore || 0) < 60 ? 0 : n.iagImpact === "directo" ? 3 : n.iagImpact === "indirecto" ? 2 : n.europe ? 1 : 0;

export async function onRequestGet({ request, env }){
  try{
    const base = new URL(request.url).origin;
    const [news, cfg, eds, votes] = await Promise.all([asset(env, request, "/data/news.json"), config(env, request), editions(env, request), readVotes(env).catch(() => ({}))]);
    const today = madridToday();
    const recency = n => { const age = Math.round((Date.parse(today) - Date.parse(n.publishedAt)) / 864e5); return Math.max(0, 6 - Math.max(0, age - 1)); };
    const prio = n => tier(n) * 101 + (n.aiScore || 0) + recency(n);

    // Likes per news item
    const t = {};
    Object.values(votes || {}).forEach(({ v }) => Object.entries(v || {}).forEach(([nid, val]) => { if(val === 1) t[nid] = (t[nid] || 0) + 1; }));
    const net = n => t[n.id] || 0;

    const sent = new Set(); (eds || []).forEach(e => (e.newsIds || []).forEach(id => sent.add(id)));
    const we = cfg.nextSend || today, ws = addDays(we, -(+cfg.windowDays || 7));
    const X = +cfg.threshold || 2, min = +cfg.minItems || 4, max = +cfg.maxItems || 6;
    const elig = (news || []).filter(n => isValid(n) && !sent.has(n.id) && n.publishedAt >= ws && n.publishedAt < we);
    const byVotes = elig.filter(n => net(n) >= X).sort((a, b) => net(b) - net(a) || prio(b) - prio(a)).slice(0, max).map(n => ({ n, origin: "votes", net: net(n) }));
    let fill = [];
    if(byVotes.length < min){
      const taken = new Set(byVotes.map(x => x.n.id));
      fill = elig.filter(n => !taken.has(n.id)).sort((a, b) => prio(b) - prio(a) || b.publishedAt.localeCompare(a.publishedAt))
        .slice(0, min - byVotes.length).map(n => ({ n, origin: "ai", net: net(n) }));
    }
    const items = [...byVotes, ...fill];

    // Images: the 16:9 email crop when it exists, else the story photo
    await Promise.all(items.map(async it => {
      const n = it.n;
      if(!n.imageId) return;
      it.img = (await assetExists(env, request, `/img/email/${n.id}.jpg`)) ? `${base}/img/email/${n.id}.jpg` : `${base}/img/${n.imageId}.jpg`;
    }));

    const issue = String((eds || []).length + 1).padStart(2, "0");
    const portal = cfg.portalUrl || base;
    const html = emailHTML({ items, issue, date: fmtDate(we), portal, base });
    const images = [`${base}/img/ntt-data.png`, ...items.map(x => x.img).filter(Boolean)];
    return json({
      issue, sendDate: we, window: { from: ws, to: addDays(we, -1) },
      subject: `The Airlines Brief · Nº ${issue} · ${fmtDate(we)}`,
      html, images,
      items: items.map(x => ({ id: x.n.id, title: x.n.title, origin: x.origin, likes: x.net }))
    });
  }catch(e){ return json({ error: e.message }, 500); }
}

function emailHTML({ items, issue, date, portal, base }){
  const badge = net => `<span style="display:inline-block;padding:2px 8px;border-radius:3px;background:#E3F3EA;color:#1B7A4B;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">&#9829; ${net} ${net === 1 ? "voto" : "votos"}</span>`;
  const home = `${portal.replace(/\/$/, "")}/?from=email&ed=${issue}`;  // marks clicks from the email in the usage stats
  const link = n => `${home}#noticia-${n.id}`;
  const photo = it => it.img
    ? `<a href="${esc(link(it.n))}" style="text-decoration:none;"><img src="${esc(it.img)}" width="260" alt="${esc(it.n.title)}" style="display:block;width:260px;max-width:100%;height:auto;border:0;margin:0 0 10px 0;"></a>`
    : `<a href="${esc(link(it.n))}" style="text-decoration:none;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;"><tr><td height="146" style="height:146px;background:#101B2C;text-align:center;vertical-align:middle;font-family:Georgia,serif;font-size:18px;color:#F2B544;">The Airlines Brief</td></tr></table></a>`;
  const card = (i, it) => { const { n, origin, net } = it; return `${photo(it)}
    <p style="margin:0 0 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;letter-spacing:2px;text-transform:uppercase;color:#1F4BC6;font-weight:bold;">${String(i + 1).padStart(2, "0")} · ${esc(CATS[n.category] || n.category)}${origin === "votes" ? "&nbsp;&nbsp;" + badge(net) : ""}</p>
    <h3 style="margin:0 0 6px 0;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:22px;color:#0F1A2A;font-weight:bold;"><a href="${esc(link(n))}" style="color:#0F1A2A;text-decoration:none;">${esc(n.title)}</a></h3>
    <p style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:20px;color:#333D4B;">${esc(n.summary)}</p>
    ${n.why ? `<p style="margin:0 0 10px 0;padding-left:8px;border-left:3px solid #F2B544;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:18px;color:#0F1A2A;"><b>Por qué importa:</b> ${esc(n.why)}</p>` : ""}
    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#566275;">${esc(n.source)} · ${fmtDate(n.publishedAt)}<br><a href="${esc(link(n))}" style="color:#1F4BC6;font-weight:bold;text-decoration:none;">Leer el artículo &rarr;</a></p>`; };
  let rows = "";
  for(let r = 0; r < items.length; r += 2){
    rows += `<tr><td style="padding:10px 32px 0 32px;"><div style="border-top:1px solid #D8DEE6;font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td style="padding:0 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
  <td width="268" valign="top" style="width:268px;padding:16px 8px 4px 0;vertical-align:top;">${card(r, items[r])}</td>
  <td width="268" valign="top" style="width:268px;padding:16px 0 4px 8px;vertical-align:top;">${items[r + 1] ? card(r + 1, items[r + 1]) : "&nbsp;"}</td>
</tr></table>
</td></tr>`;
  }
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Airlines Brief · Nº ${issue}</title></head>
<body style="margin:0;padding:0;background:#F2F4F7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F4F7;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;background:#FFFFFF;">
<tr><td style="padding:26px 32px 14px 32px;text-align:center;border-bottom:3px double #111A27;">
  <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#5A6576;">Airlines Practice</p>
  <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:42px;color:#111A27;font-weight:bold;"><a href="${esc(home)}" style="color:#111A27;text-decoration:none;">The Airlines Brief</a></h1>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0 0;"><tr><td align="right" style="padding-right:78px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:Georgia,'Times New Roman',serif;font-weight:bold;font-size:18px;line-height:18px;color:#111A27;padding-right:6px;vertical-align:middle;">by</td><td style="vertical-align:middle;"><img src="${esc(base)}/img/ntt-data.png" alt="NTT DATA" width="73" height="15" style="display:block;width:73px;height:15px;border:0;"></td></tr></table></td></tr></table>
  <p style="margin:6px 0 0 0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14px;color:#5A6576;">Actualidad, tendencias y análisis estratégico para entender qué mueve la industria aérea</p>
</td></tr>
<tr><td style="background:#101B2C;padding:10px 32px;font-family:'Courier New',Courier,monospace;font-size:13px;color:#F2B544;">EDICIÓN Nº ${issue} · ${date}</td></tr>
<tr><td style="padding:22px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#333D4B;">Este es el top ${items.length} de noticias de la última semana.</td></tr>
${rows}
<tr><td style="padding:26px 32px 0 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#111A27;border-radius:4px;"><a href="${esc(home)}" style="display:inline-block;padding:12px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#FFFFFF;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">Ver más noticias</a></td></tr></table></td></tr>
<tr><td style="padding:28px 32px 26px 32px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#8E9BB0;">Pulsa en cualquier noticia para leer el artículo completo en el portal, con sus fuentes, y votarla.</td></tr>
</table></td></tr></table></body></html>`;
}
