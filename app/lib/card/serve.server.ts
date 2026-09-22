import { env } from "cloudflare:workers";

// The public standing card's serve path (issue #3969, engine 9 P9.1; contract
// docs/REBUILD-STANDING-CARD.md).
//
// This is the only unauthenticated surface in the product, so the two rules it
// exists to keep are both refusals: it never queries live, and it never says
// anything but 404 about a card it will not serve. A 403 would confirm the slug
// is real.

// One indexed read resolves the slug and carries the publish flag with it. The
// UNIQUE index on workspace(card_slug) from 0002_card_publish.sql is what makes
// it one read rather than a scan, and it is the only thing the public path can
// learn from the tenant table.
const SELECT_PUBLISHED_WORKSPACE = `SELECT id FROM workspace
WHERE card_slug = ? AND card_is_published = 1`;

// A subject on the takedown list is removed from every card
// (docs/REBUILD-GUARDRAILS.md). Engine 10's fan-out routes that removal through
// the state machine the rest of the product already honours, so a workspace
// holding a taken-down subject is detectable here without this route reading any
// content table. The check is at serve time, not at render time, because the
// artifact can be a week old and a takedown must not wait for the next rollover.
const SELECT_TAKEDOWN = `SELECT id FROM entity
WHERE workspace_id = ? AND state = 'dismissed' AND state_reason = 'takedown' LIMIT 1`;

// Every refusal is the same 404, and it is cached like the card is. Cacheable
// refusals matter for two reasons: an unknown-slug request must not become a
// cheap oracle that the edge keeps asking the origin about, and the toggle-off
// guarantee is symmetric — the origin stops serving immediately and every edge
// copy expires inside the same minute either way.
//
// Built per request, not hoisted: a `Response` constructed in the module's
// global scope is I/O in workerd and fails the whole Worker at boot
// ("Disallowed operation called within global scope"), which is what
// `npm run e2e` catches.
function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "cache-control": "public, s-maxage=60" },
  });
}

// The weekly rollover writes card/<workspace_id>/<week_start_at>/index.html.
// The key sorts lexicographically because week_start_at is ISO-8601, so the
// newest artifact is the greatest key under the prefix and there is no second
// implementation of where a week starts. Listing rather than computing this
// week's key is also what makes the documented degraded state work: when this
// week's render failed, the previous week's card keeps serving instead of the
// URL going dark.
async function newestCardKey(bucket: R2Bucket, workspaceId: string): Promise<string | null> {
  const prefix = `card/${workspaceId}/`;
  const listed = await bucket.list({ prefix, limit: 100 });
  let newest: string | null = null;
  for (const object of listed.objects) {
    if (!object.key.endsWith("/index.html")) continue;
    if (newest === null || object.key > newest) newest = object.key;
  }
  return newest;
}

interface PublishedWorkspace {
  id: string;
}

export async function serveCard(slug: string): Promise<Response> {
  const workspace = await env.DB.prepare(SELECT_PUBLISHED_WORKSPACE)
    .bind(slug)
    .first<PublishedWorkspace>();
  if (workspace === null) return notFound();

  const taken = await env.DB.prepare(SELECT_TAKEDOWN)
    .bind(workspace.id)
    .first<{ id: string }>();
  if (taken !== null) return notFound();

  const key = await newestCardKey(env.CARD_ARTIFACTS, workspace.id);
  if (key === null) return notFound();

  const object = await env.CARD_ARTIFACTS.get(key);
  if (object === null) return notFound();

  return new Response(object.body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The whole cache mechanism. Toggling the card off flips the flag and
      // the origin stops serving immediately; edge copies expire on their own
      // inside a minute, which is the contract's "404 within a minute". A
      // purge API would need a token with cache-purge permission on the path
      // of a customer's privacy control, and the Cache API's delete is
      // per-colo, so neither is used.
      "cache-control": "public, s-maxage=60",
      "x-content-type-options": "nosniff",
    },
  });
}
