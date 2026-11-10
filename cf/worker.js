// The Airlines Brief · Cloudflare Worker: /api/* runs the functions below; everything else is a static file (dist/).
import * as votes from "../functions/api/votes.js";
import * as vote from "../functions/api/vote.js";
import * as editions from "../functions/api/editions.js";
import * as config from "../functions/api/config.js";
import * as admin from "../functions/api/admin.js";
import * as email from "../functions/api/email.js";
import * as hit from "../functions/api/hit.js";
import * as stats from "../functions/api/stats.js";
import { json } from "./lib.js";

const ROUTES = { votes, vote, editions, config, admin, email, hit, stats };

export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    const m = /^\/api\/([a-z]+)\/?$/.exec(url.pathname);
    if(m){
      const mod = ROUTES[m[1]];
      const fn = mod && (request.method === "GET" || request.method === "HEAD" ? mod.onRequestGet : request.method === "POST" ? mod.onRequestPost : null);
      if(!mod) return json({ error: "not found" }, 404);
      if(!fn) return json({ error: "method" }, 405);
      return fn({ request, env, ctx });
    }
    return env.ASSETS.fetch(request);
  }
};
