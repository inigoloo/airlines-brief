# The Airlines Brief

Portal interno de noticias del sector aéreo (Airlines Practice · NTT DATA), versión para Vercel.

- `index.html` + `shim.js`: el portal (portada, secciones, artículos con fuentes, filtros, likes).
- `data/*.json`: noticias, fuentes, ediciones y ajustes. Las actualiza la tarea diaria con un commit; Vercel republica solo.
- `img/<id>.jpg`: fotos de cada noticia (servidas también como `/_blob/<id>`).
- `api/votes.js`, `api/vote.js`: lectura y escritura de likes en Upstash Redis.
- `tools/brief.py`: genera la selección y el HTML del email quincenal.

## Configuración en Vercel (una vez)
1. Add New → Project → importar este repositorio → Deploy (sin build ni framework).
2. En el proyecto: Storage → Upstash (Redis) → crear y conectar. Añade las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN` (o `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
3. Redeploy para que las funciones lean las variables.
