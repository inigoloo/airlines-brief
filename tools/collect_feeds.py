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


# Temas que el editor no quiere (data/criterios.md): se descartan ya en la recogida para que no lleguen como candidatas.
# Carga aérea: nombres de empresa con "Cargo" (mayúscula; "cargo" en minúscula en español es otra cosa), cargueros, P2F.
# IAG Cargo sí interesa.
NOT_WANTED = [
    re.compile(r"\bCargo\b|\bCARGO\b|P2F\b|\bP2F"),
    re.compile(r"\b(air ?cargo|air ?freight|freighters?|cargueros?|carga a[ée]rea|cargo (airline|operator|terminal|handling))\b", re.I),
]
KEEP = re.compile(r"\bIAG Cargo\b", re.I)


# Prioridad orientativa para la tarea diaria (data/criterios.md): ordena candidates.txt para que lo que más interesa
# al editor salga arriba y no se pierda entre cientos de titulares. No descarta nada.
PRIO_RULES = [
    (5, re.compile(r"\b(IAG|Iberia|Vueling|British Airways|Aer Lingus|LEVEL|Avios|Iberia Express)\b", re.I)),
    (4, re.compile(r"\b(Air Europa|Globalia)\b", re.I)),
    (3, re.compile(r"Espa[ñn]a|español|españoles|española|\bAena\b|Barajas|El Prat|Madrid|Barcelona|Canarias|Baleares|M[áa]laga|Palma|Valencia|Bilbao|Sevilla", re.I)),
    (2, re.compile(r"\b(resultados?|beneficios?|p[ée]rdidas|ingresos|ebitda|earnings|profit|revenue|guidance|trimestre|semestre|quarter)\b", re.I)),
    (2, re.compile(r"\b(aerol[íi]neas|sector|bolsa|cotizaci[óo]n|precios?|tarifas?|plazas|capacidad|queroseno|combustible|petr[óo]leo|demanda|reservas)\b", re.I)),
    (2, re.compile(r"\b(Ryanair|easyJet|Lufthansa|Air France|KLM|Wizz|Volotea|Jet2|TAP|Turkish)\b", re.I)),
    (2, re.compile(r"\b(MRO|mantenimiento|maintenance|motor(es)?|engines?|taller|hangar)\b", re.I)),
]
PROMO = re.compile(r"black friday|cyber monday|descuentos?|oferta|rebajas|desde \d+ ?(€|euros)|por \d+ ?(€|euros)|sorteo|promoci[óo]n|chollo", re.I)
BIG_ES = re.compile(r"El Pa[íi]s|elEconomista|El Economista|Expansi[óo]n|Cinco D[íi]as|El Mundo|\bABC\b|La Vanguardia|Europa Press|\bEFE\b|Reuters|Financial Times|Bloomberg", re.I)


def prio_of(it):
    t = f"{it['title']} {it.get('excerpt', '')}"
    p = sum(w for w, r in PRIO_RULES if r.search(t))
    if BIG_ES.search(it.get("source", "")):
        p += 3   # gran medio generalista o económico: si lo cuenta, suele importar
    p += min(3, len(it.get("alsoIn", [])))
    if PROMO.search(t):
        p -= 6   # promociones y ofertas: no entran nunca
    return p


def not_wanted(title, excerpt=""):
    t = f"{title} {excerpt}"
    return not KEEP.search(t) and any(r.search(t) for r in NOT_WANTED)


IMG_SKIP = re.compile(r"gravatar|pixel|feedburner|1x1|spacer|/emoji/|\.svg(\?|$)|logo", re.I)


def image_of(e):
    """Imagen principal que el propio medio publica en su feed (miniatura para las noticias fuera de portada)."""
    cands = []
    for key in ("media_content", "media_thumbnail"):
        for m in e.get(key) or []:
            if m.get("url") and (m.get("medium", "image") == "image" or str(m.get("type", "")).startswith("image")):
                cands.append(m["url"])
    for l in e.get("links") or []:
        if l.get("rel") == "enclosure" and str(l.get("type", "")).startswith("image") and l.get("href"):
            cands.append(l["href"])
    for c in (e.get("content") or []) + [{"value": e.get("summary") or ""}]:
        m = re.search(r"<img[^>]+src=[\"']([^\"']+)", c.get("value") or "", re.I)
        if m:
            cands.append(html.unescape(m.group(1)))
    for u in cands:
        if u.startswith("https://") and not IMG_SKIP.search(u):
            return u
    return ""


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


def likes_report(news, now):
    """Resume los likes del portal para que las tareas aprendan qué valora el equipo (data/likes.md)."""
    import urllib.request
    try:
        req = urllib.request.Request("https://airlines-brief.inigoviu.workers.dev/api/votes", headers={"User-Agent": UA})
        votes = json.loads(urllib.request.urlopen(req, timeout=20).read().decode("utf-8"))
    except Exception as ex:
        print("likes: no se pudieron leer", ex)
        return
    t = {}
    for v in (votes or {}).values():
        for nid, val in ((v or {}).get("v") or {}).items():
            if val == 1:
                t[nid] = t.get(nid, 0) + 1
    by_id = {n["id"]: n for n in news}
    since = (now - dt.timedelta(days=45)).date().isoformat()
    recent = [n for n in news if n.get("publishedAt", "") >= since and n.get("title")]
    liked = sorted([n for n in recent if t.get(n["id"])], key=lambda n: (-t[n["id"]], n["publishedAt"]))
    cats, kinds = {}, {"Destacada": [0, 0], "Breve": [0, 0]}
    for n in recent:
        c = n.get("category", "?"); k = "Breve" if n.get("kind") == "brief" else "Destacada"
        cats.setdefault(c, [0, 0]); cats[c][0] += 1; cats[c][1] += t.get(n["id"], 0)
        kinds[k][0] += 1; kinds[k][1] += t.get(n["id"], 0)
    L = [f"# Likes del portal (últimos 45 días) · generado {now.isoformat(timespec='minutes')}",
         "",
         "Lo que el equipo marca con «me gusta» en la web. Úsalo para afinar el aiScore y la elección, junto con data/criterios.md:",
         "las noticias parecidas (mismo tipo, empresa o tema) a las más votadas tienen más peso; un tipo que nunca recibe likes, menos.",
         "Los criterios explícitos del editor (data/criterios.md) mandan sobre esto si se contradicen.",
         "", "## Más votadas", ""]
    for n in liked[:40]:
        L.append(f"- {t[n['id']]} ♥ · {n.get('publishedAt')} · {n.get('category','?')} · {'Breve' if n.get('kind') == 'brief' else 'Destacada'} · aiScore {n.get('aiScore','?')} · {n.get('source','')} · {n['title']}")
    if not liked:
        L.append("- (todavía sin likes en este periodo)")
    L += ["", "## Likes por sección (noticias · likes)", ""]
    for c, (k, v) in sorted(cats.items(), key=lambda x: -x[1][1]):
        L.append(f"- {c}: {k} noticias · {v} likes")
    L += ["", "## Destacadas frente a Breves (noticias · likes)", ""] + [f"- {k}: {a} · {b}" for k, (a, b) in kinds.items()]
    hi = [n for n in recent if (n.get("aiScore") or 0) >= 70 and not t.get(n["id"]) and n.get("publishedAt", "") <= (now - dt.timedelta(days=3)).date().isoformat()]
    L += ["", "## Con aiScore alto (70+) y ningún like tras 3 días (quizá sobrevaloradas)", ""]
    L += [f"- {n.get('publishedAt')} · {n.get('category','?')} · aiScore {n.get('aiScore')} · {n['title']}" for n in hi[:25]] or ["- (ninguna)"]
    (ROOT / "data/likes.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"likes: {sum(t.values())} likes en {len(t)} noticias")


def main():
    cfg = json.loads((ROOT / "feeds/feeds.json").read_text(encoding="utf-8"))
    news = json.loads((ROOT / "data/news.json").read_text(encoding="utf-8"))
    known_urls = {clean_url(n.get("url", "")) for n in news}
    images = {}   # url limpia -> imagen del feed (también de noticias ya publicadas, para completar miniaturas)
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
                img = "" if f.get("google") else image_of(e)
                if link and img:
                    images[clean_url(link)] = img
                if f.get("filter") and not AVIATION.search(title + " " + excerpt):
                    continue
                cu, nt = clean_url(link), norm_title(title)
                if not link or cu in known_urls or cu in seen_u or nt in seen_t:
                    continue
                if f.get("exclude") and re.search(f["exclude"], title, re.I):
                    continue
                if not_wanted(title, excerpt):
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
                    "viaGoogle": bool(f.get("google")), "image": img, "_w": words,
                })
                st["kept"] += 1; kept += 1
        except Exception as ex:  # un feed caído no para el resto
            st["error"] = str(ex)[:200]
        status.append(st)
    # Completa la miniatura de las noticias fuera de portada ya publicadas que aún no la tienen
    filled = 0
    for n in news:
        if n.get("kind") == "brief" and not n.get("thumb"):
            im = images.get(clean_url(n.get("url", "")))
            if im:
                n["thumb"] = im; filled += 1
    if filled:
        (ROOT / "data/news.json").write_text(json.dumps(news, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"miniaturas añadidas a {filled} noticias fuera de portada")
    likes_report(news, now)
    items.sort(key=lambda x: x["published"], reverse=True)
    for i, it in enumerate(items, 1):
        it.pop("_w", None)
        it["id"] = f"c{i:03d}"
    # Vista compacta para la tarea diaria: una línea por candidata (el detalle está en el JSON, por id)
    for it in items:
        it["prio"] = prio_of(it)
    lines = [f"# {len(items)} candidatas · últimas {hours} h · generado {now.isoformat(timespec='minutes')}",
             "# Ordenadas por prioridad orientativa (criterios del editor: IAG, Air Europa, España, resultados, sector, competidores, MRO, grandes medios).",
             "# Revisa SIEMPRE todas las de prioridad 7 o más: son las que el editor espera ver.",
             "# prio | id | fecha UTC | tema | medio (+ otros medios con la misma noticia) | titular"]
    big = [it for it in items if BIG_ES.search(it.get("source", "")) and not PROMO.search(it["title"])]
    if big:
        lines.append("# --- GRANDES MEDIOS (El País, elEconomista, Expansión, Cinco Días, El Mundo, ABC, Reuters, FT, Bloomberg…): léelas TODAS una por una; si cuentan una tendencia del sector o algo de España/IAG/Air Europa, suelen ser Destacada ---")
        for it in sorted(big, key=lambda x: x["published"], reverse=True):
            lines.append(f"{it['prio']:>2} | {it['id']} | {it['published'][5:16].replace('T', ' ')} | {it['topic']} | {it['source']} | {it['title']}")
        lines.append("# --- TODAS LAS CANDIDATAS, por prioridad ---")
    for it in sorted(items, key=lambda x: (-x["prio"], x["published"])):
        also = f" (+{len(it['alsoIn'])}: {', '.join(it['alsoIn'][:3])})" if it.get("alsoIn") else ""
        lines.append(f"{it['prio']:>2} | {it['id']} | {it['published'][5:16].replace('T', ' ')} | {it['topic']} | {it['source']}{also} | {it['title']}")
    (ROOT / "feeds/candidates.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    out = {"generatedAt": now.isoformat(timespec="minutes"), "hours": hours, "count": len(items),
           "feedsOk": sum(s["ok"] for s in status), "feedsTotal": len(status), "feeds": status, "items": items}
    (ROOT / "feeds/candidates.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(items)} candidatas · {out['feedsOk']}/{len(status)} feeds OK")
    for s in status:
        print(("OK " if s["ok"] else "ERR"), s["name"], s["entries"], s["kept"], s["error"])


if __name__ == "__main__":
    sys.exit(main())
