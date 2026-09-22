interface InboxEnv {
  INBOX: KVNamespace;
  E2E_INBOX_TOKEN?: string;
}

const tokenMatches = (presented: string, expected: string) => {
  if (presented.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < presented.length; i++) {
    difference |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
};

// The J1/J2 mail sink, decided on 0509#3927 (2026-09-22): Email Routing sends
// e2e@0509.io here, the raw MIME lands in KV under the recipient address with
// a one-hour TTL, and the Playwright suite reads it back through GET /message.
// A test-only route inside the app was explicitly rejected — this Worker is a
// separate deployment so the magic link travels the whole real path.
export default {
  async email(message, env, ctx) {
    const raw = await new Response(message.raw).text();
    ctx.waitUntil(env.INBOX.put(message.to, raw, { expirationTtl: 3600 }));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/message") {
      return new Response("not found", { status: 404 });
    }
    if (!env.E2E_INBOX_TOKEN) {
      return new Response("E2E_INBOX_TOKEN is not set on 0509-e2e-inbox", { status: 503 });
    }
    const presented = request.headers.get("authorization") ?? "";
    if (!tokenMatches(presented, `Bearer ${env.E2E_INBOX_TOKEN}`)) {
      return new Response("forbidden", { status: 403 });
    }
    const to = url.searchParams.get("to");
    if (!to) {
      return new Response("missing ?to=", { status: 400 });
    }
    const message = await env.INBOX.get(to);
    if (message === null) {
      return new Response("no message stored for recipient", { status: 404 });
    }
    return new Response(message, { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
} satisfies ExportedHandler<InboxEnv>;
