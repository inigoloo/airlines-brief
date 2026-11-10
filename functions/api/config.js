// GET /api/config -> newsletter settings (repo config.json, overridden by newer changes saved from the web)
import { json, config } from "../../cf/lib.js";
export async function onRequestGet({ request, env }){
  try{ return json(await config(env, request)); }
  catch(e){ return json({ error: "No se pudo leer la configuración" }, 500); }
}
