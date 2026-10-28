#!/usr/bin/env python3
"""The Airlines Brief: edition selection + Klaviyo email builder.

Input: a directory with the portal database exported by ArtifactData (out_dir):
  <db>/news/*.json  <db>/votes/*.json  <db>/editions/*.json  <db>/config/settings.json
Each file holds the document body; the document id is the file name.

Usage:
  python3 brief.py <db_dir> <out_dir> [--ids id1,id2,...] [--date YYYY-MM-DD]

Rule (same as the portal):
  - Candidates: valid news (title, source, https URL, date) not used in a previous
    edition and published in the 7 days before the send date (windowDays in config).
  - Ordering weight = aiScore + a slight recency boost (+6 for the last two days, -1 per older day).
  - By votes: candidates with likes >= threshold (default 3, i.e. "more than 2"),
    most liked first, at most maxItems (default 6).
  - If fewer than minItems (default 4): fill with the most important remaining
    candidates by priority tier (IAG direct > IAG indirect > Europe > rest),
    then aiScore. --ids overrides the AI fill with an explicit
    ordered list chosen by the editor/Claude (vote picks always stay first).
Writes <out>/selection.json, <out>/email.html, <out>/email.txt
"""
import json, glob, os, sys, re, html, datetime

MONTHS = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"]
CATS = {"FIN":"Finanzas","STR":"Estrategia","CUS":"Cliente","NET":"Red","FLT":"Flota"}

def load(dirpath):
    out = {}
    for f in sorted(glob.glob(os.path.join(dirpath, "*.json"))):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        if isinstance(d, dict) and "data" in d and isinstance(d["data"], dict) and "id" in d:
            d = d["data"]
        out[os.path.splitext(os.path.basename(f))[0]] = d
    return out

def fmt(iso):
    if not iso: return ""
    y, m, d = iso[:10].split("-")
    return f"{d} {MONTHS[int(m)-1]} {y}"

def valid(n):
    return bool(n.get("title") and n.get("source") and re.match(r"^https://\S+$", n.get("url","")) and re.match(r"^\d{4}-\d{2}-\d{2}$", n.get("publishedAt","")))

def add_days(iso, k):
    return (datetime.date.fromisoformat(iso) + datetime.timedelta(days=k)).isoformat()

def e(s): return html.escape(str(s or ""), quote=True)

def tier(n):
    """Editorial priority tier: IAG direct > IAG indirect > Europe > rest.
    Only news of real industry/economic weight (aiScore >= 60) get a tier; minor news rank by importance alone."""
    if (n.get("aiScore") or 0) < 60: return 0
    i = n.get("iagImpact")
    return 3 if i == "directo" else 2 if i == "indirecto" else 1 if n.get("europe") else 0

def main():
    args = sys.argv[1:]
    if len(args) < 2: sys.exit(__doc__)
    db, out = args[0], args[1]
    forced = []; send_date = None
    if "--ids" in args: forced = [x for x in args[args.index("--ids")+1].split(",") if x]
    if "--date" in args: send_date = args[args.index("--date")+1]
    os.makedirs(out, exist_ok=True)

    news = load(os.path.join(db, "news"))
    votes = load(os.path.join(db, "votes"))
    editions = load(os.path.join(db, "editions"))
    cfg = {"threshold":3, "minItems":4, "maxItems":6, "nextSend":"", "cadenceDays":14, "portalUrl":""}
    sf = os.path.join(db, "config", "settings.json")
    if os.path.exists(sf):
        s = json.load(open(sf, encoding="utf-8")); cfg.update(s.get("data", s) if "data" in s and isinstance(s.get("data"), dict) else s)
    X, mn, mx = int(cfg["threshold"]), int(cfg["minItems"]), int(cfg["maxItems"])

    likes = {}
    for v in votes.values():
        for nid, val in (v.get("v") or {}).items():
            if val == 1: likes[nid] = likes.get(nid, 0) + 1
    sent = {i for ed in editions.values() for i in ed.get("newsIds", [])}
    # Weekly edition: only news published in the 7 days before the send date (and never repeated).
    send_day = send_date or cfg.get("nextSend") or datetime.date.today().isoformat()
    ws = add_days(send_day, -int(cfg.get("windowDays", 7)))
    def recency(n):
        """Slight boost for fresher news: +6 for news from the send day or the day before, -1 per older day (min 0)."""
        age = (datetime.date.fromisoformat(send_day) - datetime.date.fromisoformat(n["publishedAt"])).days
        return max(0, 6 - max(0, age - 1))
    def weight(n): return (n.get("aiScore") or 0) + recency(n)

    elig = [dict(n, id=k, likes=likes.get(k,0)) for k, n in news.items() if valid(n) and k not in sent and n["publishedAt"] >= ws]
    by_votes = sorted([n for n in elig if n["likes"] >= X], key=lambda n: (-n["likes"], -weight(n)))[:mx]
    for n in by_votes: n["origin"] = "votes"
    items = list(by_votes)
    if len(items) < mn:
        taken = {n["id"] for n in items}
        pool = {n["id"]: n for n in elig if n["id"] not in taken}
        if forced:
            fill = [pool[i] for i in forced if i in pool]
        else:
            fill = sorted(pool.values(), key=lambda n: (-tier(n), -weight(n), [-ord(c) for c in n["publishedAt"]]))
        for n in fill[: mn - len(items)]:
            n["origin"] = "ai"; items.append(n)

    issue = len(editions) + 1
    date = send_date or cfg.get("nextSend") or datetime.date.today().isoformat()
    portal = cfg.get("portalUrl", "")
    rows = []
    def link(n):
        """Portal article page for this story (falls back to the source if no portal URL is configured)."""
        return f"{portal}#noticia-{n['id']}" if portal else n["url"]
    def badge_html(n):
        if n["origin"] != "votes": return ""
        return f'&nbsp;&nbsp;<span style="display:inline-block;padding:2px 7px;border-radius:3px;background:#E3F3EA;color:#1B7A4B;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">&#9829; {n["likes"]} {"voto" if n["likes"] == 1 else "votos"}</span>'
    def photo_html(n, w):
        if not str(n.get("photoUrl","")).startswith("https://"): return ""
        return f'<a href="{e(link(n))}" style="text-decoration:none;"><img src="{e(n["photoUrl"])}" width="{w}" alt="{e(n["title"])}" style="display:block;width:100%;max-width:{w}px;height:auto;border:0;margin:0 0 12px 0;"></a>'
    def label_html(i, n):
        return f'<p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;letter-spacing:2px;text-transform:uppercase;color:#1F4BC6;font-weight:bold;">{i+1:02d} · {e(CATS.get(n.get("category"), n.get("category")))}{badge_html(n)}</p>'
    def foot_html(n):
        return f'<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#566275;">{e(n["source"])} · {fmt(n["publishedAt"])}<br><a href="{e(link(n))}" style="color:#1F4BC6;font-weight:bold;text-decoration:none;">Leer el artículo &rarr;</a></p>'
    def why_html(n, size, lh):
        if not n.get("why"): return ""
        return f'<p style="margin:0 0 10px 0;padding-left:10px;border-left:3px solid #F2B544;font-family:Arial,Helvetica,sans-serif;font-size:{size}px;line-height:{lh}px;color:#0F1A2A;"><b>Por qué importa:</b> {e(n.get("why"))}</p>'
    # 1) Lead story, full width
    if items:
        n = items[0]
        rows.append(f'''<tr><td style="padding:22px 32px 0 32px;">
  {photo_html(n, 536)}
  {label_html(0, n)}
  <h2 style="margin:0 0 8px 0;font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:29px;color:#0F1A2A;font-weight:bold;"><a href="{e(link(n))}" style="color:#0F1A2A;text-decoration:none;">{e(n["title"])}</a></h2>
  <p style="margin:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#333D4B;">{e(n.get("summary"))}</p>
  {why_html(n, 14, 21)}
  {foot_html(n)}
</td></tr>''')
    # 2) The rest in a 2-column grid (fluid-hybrid: two columns on desktop, stacked on narrow screens)
    def card(i, n):
        return f'''<div style="display:inline-block;width:100%;max-width:260px;vertical-align:top;font-size:14px;text-align:left;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:18px 0 4px 0;">
    {photo_html(n, 260)}
    {label_html(i, n)}
    <h3 style="margin:0 0 6px 0;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:22px;color:#0F1A2A;font-weight:bold;"><a href="{e(link(n))}" style="color:#0F1A2A;text-decoration:none;">{e(n["title"])}</a></h3>
    <p style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:20px;color:#333D4B;">{e(n.get("summary"))}</p>
    {why_html(n, 12.5, 18)}
    {foot_html(n)}
  </td></tr></table>
</div>'''
    rest = items[1:]
    for r in range(0, len(rest), 2):
        pair = rest[r:r+2]
        cells = []
        for k, n in enumerate(pair):
            cells.append(card(r + k + 1, n))
        ghost_mid = '<!--[if mso]></td><td width="16" style="width:16px;"></td><td width="260" valign="top" style="width:260px;"><![endif]-->'
        spacer = '<div style="display:inline-block;width:16px;font-size:0;line-height:0;">&nbsp;</div>'
        inner = (spacer + ghost_mid).join(cells)
        rows.append(f'''<tr><td style="padding:10px 32px 0 32px;"><div style="border-top:1px solid #D8DEE6;"></div></td></tr>
<tr><td style="padding:0 32px;font-size:0;text-align:left;">
<!--[if mso]><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0"><tr><td width="260" valign="top" style="width:260px;"><![endif]-->
{inner}
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>''')
    intro = f"Las {len(items)} noticias que más importan esta semana."
    cta = f'''<tr><td style="padding:26px 32px 0 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#111A27;border-radius:4px;"><a href="{e(portal)}" style="display:inline-block;padding:12px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#FFFFFF;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">Vota las noticias de la próxima edición</a></td></tr></table></td></tr>''' if portal else ""
    doc = f'''<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Airlines Brief · Nº {issue:02d}</title></head>
<body style="margin:0;padding:0;background:#F2F4F7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F4F7;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;">
<tr><td style="padding:26px 32px 14px 32px;text-align:center;border-bottom:3px double #111A27;">
  <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#5A6576;">Airlines Practice</p>
  <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:42px;color:#111A27;font-weight:bold;">The Airlines Brief</h1>
  <p style="margin:6px 0 0 0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14px;color:#5A6576;">Actualidad, tendencias y análisis estratégico para entender qué mueve la industria aérea</p>
</td></tr>
<tr><td style="background:#101B2C;padding:10px 32px;font-family:'Courier New',Courier,monospace;font-size:13px;color:#F2B544;">EDICIÓN Nº {issue:02d} · {fmt(date)}</td></tr>
<tr><td style="padding:22px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#333D4B;">{e(intro)}</td></tr>
{"".join(rows)}
{cta}
<tr><td style="padding:28px 32px 26px 32px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#8E9BB0;">Pulsa en cualquier noticia para leer el artículo completo en el portal, con sus fuentes, y votarla.<br>{{% unsubscribe 'Darse de baja' %}}</td></tr>
</table></td></tr></table></body></html>'''
    text = f"THE AIRLINES BRIEF · Nº {issue:02d} · {fmt(date)}\n\n" + "\n\n".join(
        f"{i+1:02d}. {('[' + str(n['likes']) + (' voto' if n['likes'] == 1 else ' votos') + '] ') if n['origin'] == 'votes' else ''}{n['title']}\n{n.get('summary','')}\nPor qué importa: {n.get('why','')}\n{n['source']} · " + (f"{portal}#noticia-{n['id']}" if portal else n['url']) for i, n in enumerate(items)) + \
        (f"\n\nVota las noticias de la próxima edición: {portal}" if portal else "") + "\n\n{% unsubscribe 'Darse de baja' %}"
    lead = items[0]["title"] if items else ""
    short = lead.split(":")[0].split(",")[0]
    subject = f"The Airlines Brief Nº {issue:02d} · {short}"
    if len(subject) > 80: subject = subject[:79].rsplit(" ", 1)[0] + "…"
    sel = {"issue": issue, "date": date, "windowStart": ws, "threshold": X, "minItems": mn, "maxItems": mx,
           "byVotes": len(by_votes), "subject": subject,
           "previewText": " · ".join(n["title"] for n in items[1:3])[:140],
           "items": [{"id": n["id"], "title": n["title"], "source": n["source"], "likes": n["likes"], "aiScore": n.get("aiScore"), "origin": n["origin"]} for n in items],
           "candidates": [{"id": n["id"], "title": n["title"], "likes": n["likes"], "iagImpact": n.get("iagImpact"), "europe": bool(n.get("europe")), "aiScore": n.get("aiScore"), "recencyBoost": recency(n), "publishedAt": n["publishedAt"]} for n in sorted(elig, key=lambda n: (-n["likes"], -tier(n), -weight(n)))]}
    json.dump(sel, open(os.path.join(out, "selection.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    open(os.path.join(out, "email.html"), "w", encoding="utf-8").write(doc)
    open(os.path.join(out, "email.txt"), "w", encoding="utf-8").write(text)
    print(json.dumps({k: sel[k] for k in ("issue","date","byVotes","subject","items")}, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
