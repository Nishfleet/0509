interface InboxEnv {
  INBOX: KVNamespace;
  E2E_INBOX_TOKEN?: string;
}

const timingSafeEqual = (
  crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
  }
).timingSafeEqual.bind(crypto.subtle);

export default {
  async email(message, env) {
    
    
    
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
