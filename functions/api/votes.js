// GET /api/votes -> { "<voterId>": { "v": { "<newsId>": 1, ... } }, ... }
import { json, readVotes } from "../../cf/lib.js";
export async function onRequestGet({ env }){
  try{ return json(await readVotes(env)); }
  catch(e){ return json({ error: "No se pudieron leer los votos" }, 500); }
}
