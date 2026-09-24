import { env } from "cloudflare:workers";

const SELECT_PUBLISHED_WORKSPACE = `SELECT id FROM workspace
WHERE card_slug = ? AND card_is_published = 1`;

const SELECT_TAKEDOWN = `SELECT id FROM entity
WHERE workspace_id = ? AND state = 'dismissed' AND state_reason = 'takedown' LIMIT 1`;

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "cache-control": "public, s-maxage=60" },
  });
}

async function newestCardKey(bucket: R2Bucket, workspaceId: string): Promise<string | null> {
  const prefix = `card/${workspaceId}/`;
  let cursor: string | undefined;
  let newest: string | null = null;
  do {
    const listed: R2Objects = await bucket.list({ prefix, limit: 1000, cursor });
    for (const object of listed.objects) {
      if (!object.key.endsWith("/index.html")) continue;
      if (newest === null || object.key > newest) newest = object.key;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);
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
      "cache-control": "public, s-maxage=60",
      "x-content-type-options": "nosniff",
    },
  });
}
