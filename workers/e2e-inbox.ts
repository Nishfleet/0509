interface InboxEnv {
  INBOX: KVNamespace;
  E2E_INBOX_TOKEN?: string;
}

// The J1 mail sink, decided on 0509#3927 (2026-09-22): Email Routing's
// e2e@0509.io rule delivers here — per-run addresses are e2e+<run-id>@0509.io,
// which the same rule catches because subaddressing (RFC 5233) is enabled on
// the zone and preserves the full recipient in message.to. The raw MIME lands
// in KV under that address with a one-hour TTL, and the Playwright suite
// reads it back through GET /message. A test-only route inside the app was
// explicitly rejected — this Worker is a separate deployment so the magic
// link travels the whole real path.
// workerd's SubtleCrypto.timingSafeEqual — a synchronous constant-time
// compare. The DOM lib's SubtleCrypto declaration shadows the workers-types
// one under tsconfig.cloudflare.json, so the method's signature is restored
// locally; the runtime call is the real one (exercised by the integration
// test's 403/200 rows).
const timingSafeEqual = (
  crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
  }
).timingSafeEqual.bind(crypto.subtle);

export default {
  async email(message, env) {
    // Awaited, not waitUntil'd: a failed put rejects the delivery so Email
    // Routing retries, instead of the test blaming a missing rule for what
    // was really a dropped write.
    const raw = await new Response(message.raw).text();
    await env.INBOX.put(message.to, raw, { expirationTtl: 3600 });
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/message") {
      return new Response("not found", { status: 404 });
    }
    if (!env.E2E_INBOX_TOKEN) {
      return new Response("E2E_INBOX_TOKEN is not set on 0509-e2e-inbox", { status: 503 });
    }
    const presented = new TextEncoder().encode(request.headers.get("authorization") ?? "");
    const expected = new TextEncoder().encode(`Bearer ${env.E2E_INBOX_TOKEN}`);
    const match =
      presented.byteLength === expected.byteLength && timingSafeEqual(presented, expected);
    if (!match) {
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
