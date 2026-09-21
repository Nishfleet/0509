import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/**
 * INTERIM. Remove this with the three `*.0509.in` routes in wrangler.jsonc the
 * moment a zone-level Redirect Rule on 0509.in is in place — that is the stock
 * mechanism and it costs no Worker invocation. Tracked as item 11 on #3912,
 * because creating it needs a token with Zone:Rulesets:Edit, which is Nish's
 * call and not something CI's deploy token is known to carry.
 *
 * Why this exists at all: C4 carried the six routes from the old config but not
 * the behaviour they existed for, so all three .in hosts started serving the
 * full app instead of redirecting. CLAUDE.md is explicit that these names are
 * compatibility routes only and must never carry product copy, auth origins or
 * SEO links — and with BETTER_AUTH_URL pinned to .io, serving auth pages on .in
 * is an origin mismatch as well as duplicate content.
 */
function compatibilityRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (!url.hostname.endsWith(".0509.in") && url.hostname !== "0509.in") return null;

  // Path and query preserved; api.0509.in → api.0509.io, www → www, bare → bare.
  url.hostname = url.hostname.replace(/0509\.in$/, "0509.io");
  return Response.redirect(url.toString(), 308);
}

export default {
  async fetch(request) {
    return compatibilityRedirect(request) ?? requestHandler(request);
  },

  async scheduled(_controller, _env, ctx) {
    // The dead-man ping: an external service alerts when the reports stop,
    // which is the one failure a Worker cannot report about itself.
    const ping = pingLiveness();
    if (ping) ctx.waitUntil(ping);
  },
} satisfies ExportedHandler<Env>;
