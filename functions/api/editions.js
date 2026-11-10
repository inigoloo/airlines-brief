// GET /api/editions -> recorded editions (repo + those marked as sent from the web)
import { json, editions } from "../../cf/lib.js";
export async function onRequestGet({ request, env }){
  try{ return json(await editions(env, request)); }
  catch(e){ return json({ error: "No se pudieron leer las ediciones" }, 500); }
}
