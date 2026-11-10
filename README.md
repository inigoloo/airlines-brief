# The Airlines Brief

Portal interno de noticias del sector aéreo (Airlines Practice · NTT DATA).
Web: https://airlines-brief.inigoviu.workers.dev (Cloudflare Worker conectado a este repositorio, rama `main`).

- `index.html` + `shim.js`: el portal (portada, secciones, artículos con fuentes, búsqueda, filtro de fechas, likes).
- `data/*.json`: noticias, fuentes, ediciones y ajustes. Las actualiza la tarea diaria con un commit; Cloudflare republica solo.
- `img/<id>.jpg`: fotos de cada noticia (servidas también como `/_blob/<id>`).
- `cf/worker.js`, `cf/lib.js`, `functions/api/*.js`: la API (`/api/votes`, `/api/vote`, `/api/editions`, `/api/config`, `/api/admin`, `/api/email`) sobre Cloudflare D1 (base de datos `airlines-brief`).
- `wrangler.toml`, `tools/cf-build.sh`: configuración y build de Cloudflare (copia los archivos públicos a `dist/`).
- `api/*.js`, `vercel.json`: versión anterior en Vercel; ahora `airlines-brief.vercel.app` redirige a la web de Cloudflare.
- `tools/brief.py`: selección y HTML del email (versión anterior; el borrador de Outlook usa `/api/email`).
