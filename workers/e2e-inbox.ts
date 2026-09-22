import { DurableObject } from "cloudflare:workers";

const HOUR_MS = 60 * 60 * 1000;

interface InboxEnv {
  INBOX: DurableObjectNamespace<InboxMailbox>;
  E2E_INBOX_TOKEN?: string;
}

const timingSafeEqual = (
  crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
  }
).timingSafeEqual.bind(crypto.subtle);

export class InboxMailbox extends DurableObject<InboxEnv> {
  constructor(ctx: DurableObjectState, env: InboxEnv) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS message (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          raw TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
      );
      return Promise.resolve();
    });
  }

  async store(raw: string): Promise<void> {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO message (id, raw, created_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET raw = excluded.raw, created_at = excluded.created_at`,
      raw,
      now,
    );
    
    
    await this.ctx.storage.setAlarm(now + HOUR_MS);
  }

  read(): string | null {
    const row = this.ctx.storage.sql
      .exec<{ raw: string; created_at: number }>("SELECT raw, created_at FROM message WHERE id = 1")
      .toArray()[0];
    if (!row) return null;
    if (row.created_at + HOUR_MS <= Date.now()) {
      this.ctx.storage.sql.exec("DELETE FROM message WHERE id = 1");
      return null;
    }
    return row.raw;
  }

  alarm(): void {
    this.ctx.storage.sql.exec("DELETE FROM message");
  }
}

export default {
  async email(message, env) {
    
    
    
    const raw = await new Response(message.raw).text();
    await env.INBOX.getByName(message.to).store(raw);
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
    const message = await env.INBOX.getByName(to).read();
    if (message === null) {
      return new Response("no message stored for recipient", { status: 404 });
    }
    return new Response(message, { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
} satisfies ExportedHandler<InboxEnv>;
