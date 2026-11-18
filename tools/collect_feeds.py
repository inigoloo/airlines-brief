"""Recoge noticias candidatas de los feeds RSS de feeds/feeds.json, sin IA.

Escribe feeds/candidates.json con las noticias de las últimas HOURS horas que aún no están en
data/news.json, y un estado por feed (para ver cuáles fallan). Se ejecuta en GitHub Actions.
"""
import json, re, sys, html, time, datetime as dt
from pathlib import Path
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
import feedparser

ROOT = Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (compatible; AirlinesBriefBot/1.0; +https://airlines-brief.inigoviu.workers.dev)"
AVIATION = re.compile(r"\b(aerol[ií]nea|aeropuert|avi[oó]n|aviones|aviaci[oó]n|vuelo|airline|airport|aircraft|aviation|flight|airbus|boeing|embraer|iberia|vueling|air europa|ryanair|easyjet|lufthansa|iag|aena|mro|motor|engine|queroseno|jet fuel|pasajeros|passengers)", re.I)


def clean_url(u):
    p = urlparse(u)
    q = [(k, v) for k, v in parse_qsl(p.query) if not k.lower().startswith(("utm_", "fbclid", "gclid"))]
    return urlunparse((p.scheme, p.netloc.lower(), p.path.rstrip("/"), "", urlencode(q), ""))


def text(s, n=280):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[: n - 1].rsplit(" ", 1)[0] + "…"


def similar(a, b):
    """Dos titulares cuentan lo mismo si comparten la mayoría de sus palabras significativas."""
    if not a or not b:
        return False
    return len(a & b) / min(len(a), len(b)) >= 0.6 and len(a & b) >= 3


def norm_title(t):
    return re.sub(r"[^a-z0-9áéíóúñü ]", "", (t or "").lower()).strip()


def main():
    cfg = json.loads((ROOT / "feeds/feeds.json").read_text(encoding="utf-8"))
    news = json.loads((ROOT / "data/news.json").read_text(encoding="utf-8"))
    known_urls = {clean_url(n.get("url", "")) for n in news}
    for n in news:
        for r in n.get("refs", []) or []:
            known_urls.add(clean_url(r.get("url", "")))
    now = dt.datetime.now(dt.timezone.utc)
    hours = 72 if (now + dt.timedelta(hours=1)).weekday() == 0 else 48   # los lunes, todo el fin de semana
    since = now - dt.timedelta(hours=hours)
    items, status, seen_t = [], [], set()
    seen_u = set()
    for f in cfg["feeds"]:
        st = {"name": f["name"], "url": f["url"], "ok": False, "entries": 0, "kept": 0, "error": ""}
        try:
            for attempt in range(3):   # Google News a veces responde con una página en vez del feed: reintento
                if f.get("google"):
                    time.sleep(2 + 3 * attempt)
                d = feedparser.parse(f["url"], agent=UA, request_headers={"Accept-Language": "es,en;q=0.8"})
                if d.entries or not d.get("bozo"):
                    break
            if d.get("bozo") and not d.entries:
                raise RuntimeError(str(d.get("bozo_exception", "feed no válido"))[:200])
            if getattr(d, "status", 200) >= 400:
                raise RuntimeError(f"HTTP {d.status}")
            st["ok"], st["entries"] = True, len(d.entries)
            kept = 0
            for e in d.entries:
                if kept >= f.get("max", 60):
                    break
                t = e.get("published_parsed") or e.get("updated_parsed")
                if not t:
                    continue
                when = dt.datetime.fromtimestamp(time.mktime(t), dt.timezone.utc)
                if when < since or when > now + dt.timedelta(hours=2):
                    continue
                title = text(e.get("title"), 300)
                link = e.get("link") or ""
                source = f["name"]
                if f.get("google"):
                    # Google News: el título acaba en " - Medio"; el enlace es de Google (el medio se busca después)
                    src = (e.get("source") or {}).get("title")
                    if src:
                        source = src
                        title = re.sub(r"\s+-\s+" + re.escape(src) + r"\s*$", "", title)
                excerpt = "" if f.get("google") else text(e.get("summary") or e.get("description"))
                if f.get("filter") and not AVIATION.search(title + " " + excerpt):
                    continue
                cu, nt = clean_url(link), norm_title(title)
                if not link or cu in known_urls or cu in seen_u or nt in seen_t:
                    continue
                if f.get("exclude") and re.search(f["exclude"], title, re.I):
                    continue
                words = set(w for w in nt.split() if len(w) > 3)
                dup = next((it for it in items if similar(words, it["_w"])), None)
                if dup:   # la misma noticia en otro medio: se anota como otra fuente, no como candidata nueva
                    dup.setdefault("alsoIn", []).append(source)
                    continue
                seen_u.add(cu); seen_t.add(nt)
                items.append({
                    "title": title, "source": source, "url": link, "published": when.isoformat(timespec="minutes"),
                    "excerpt": excerpt, "feed": f["name"], "lang": f.get("lang", ""), "topic": f.get("topic", ""),
                    "viaGoogle": bool(f.get("google")), "_w": words,
                })
                st["kept"] += 1; kept += 1
        except Exception as ex:  # un feed caído no para el resto
            st["error"] = str(ex)[:200]
        status.append(st)
    items.sort(key=lambda x: x["published"], reverse=True)
    for i, it in enumerate(items, 1):
        it.pop("_w", None)
        it["id"] = f"c{i:03d}"
    # Vista compacta para la tarea diaria: una línea por candidata (el detalle está en el JSON, por id)
    lines = [f"# {len(items)} candidatas · últimas {hours} h · generado {now.isoformat(timespec='minutes')}",
             "# id | fecha UTC | tema | medio (+ otros medios con la misma noticia) | titular"]
    for it in items:
        also = f" (+{len(it['alsoIn'])}: {', '.join(it['alsoIn'][:3])})" if it.get("alsoIn") else ""
        lines.append(f"{it['id']} | {it['published'][5:16].replace('T', ' ')} | {it['topic']} | {it['source']}{also} | {it['title']}")
    (ROOT / "feeds/candidates.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    out = {"generatedAt": now.isoformat(timespec="minutes"), "hours": hours, "count": len(items),
           "feedsOk": sum(s["ok"] for s in status), "feedsTotal": len(status), "feeds": status, "items": items}
    (ROOT / "feeds/candidates.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(items)} candidatas · {out['feedsOk']}/{len(status)} feeds OK")
    for s in status:
        print(("OK " if s["ok"] else "ERR"), s["name"], s["entries"], s["kept"], s["error"])


if __name__ == "__main__":
    sys.exit(main())
