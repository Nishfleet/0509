import {
  createExecutionContext,
  env,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../../workers/e2e-inbox";
import type { InboxMailbox } from "../../workers/e2e-inbox";

/**
 * The mail-sink Worker's token gate and mailbox write, in real workerd
 * against a real local SQLite Durable Object. The same binding kinds
 * production gets. A missing or wrong secret must fail loudly (0509#3927),
 * which is what the 503/403 rows pin. The read-after-write row pins the
 * reason KV was removed (0509#4210): a read before the write is 404, and
 * the next read is 200 with no wait.
 */
type EmailMessage = Parameters<typeof worker.email>[0];

const MIME = [
  "From: Five to Nine <hello@0509.io>",
  "To: e2e+vitest@0509.io",
  "Subject: Your sign-in link",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Sign in to Five to Nine:",
  "",
  "https://0509.io/api/auth/magic-link/verify?token=abc123",
].join("\r\n");

const fakeMessage = (to: string, raw: string): EmailMessage =>
  ({
    to,
    from: "hello@0509.io",
    headers: new Headers(),
    raw: new Response(raw).body,
    rawSize: raw.length,
    setReject: () => undefined,
    forward: () => Promise.resolve(),
    reply: () => Promise.resolve(),
  }) as unknown as EmailMessage;

const get = (path: string, token = "integration-token") =>
  worker.fetch(
    new Request(`https://e2e-inbox.test${path}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    env,
    createExecutionContext(),
  );

const messagePath = (to: string) => `/message?to=${encodeURIComponent(to)}`;

describe("0509-e2e-inbox", () => {
  it("stores a delivered email under the full recipient address", async () => {
    const to = "e2e+vitest@0509.io";
    const ctx = createExecutionContext();
    await worker.email(fakeMessage(to, MIME), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await env.INBOX.getByName(to).read()).toBe(MIME);
  });

  it("reads 404 before the write and 200 immediately after, with no wait", async () => {
    const to = "e2e+immediate@0509.io";
    expect((await get(messagePath(to))).status).toBe(404);

    const ctx = createExecutionContext();
    await worker.email(fakeMessage(to, MIME), env, ctx);
    await waitOnExecutionContext(ctx);

    const res = await get(messagePath(to));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(MIME);
  });

  it("reads a message older than one hour as 404", async () => {
    const to = "e2e+expired@0509.io";
    const ctx = createExecutionContext();
    await worker.email(fakeMessage(to, MIME), env, ctx);
    await waitOnExecutionContext(ctx);
    const stub = env.INBOX.getByName(to);
    await runInDurableObject(stub, async (_instance: InboxMailbox, state) => {
      state.storage.sql.exec(
        "UPDATE message SET created_at = ? WHERE id = 1",
        Date.now() - 60 * 60 * 1000 - 1,
      );
    });
    expect((await get(messagePath(to))).status).toBe(404);
  });

  it("serves a stored message to the bearer token", async () => {
    const ctx = createExecutionContext();
    await worker.email(fakeMessage("e2e+vitest@0509.io", MIME), env, ctx);
    const res = await worker.fetch(
      new Request("https://e2e-inbox.test/message?to=e2e%2Bvitest%400509.io", {
        headers: { authorization: "Bearer integration-token" },
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(MIME);
  });

  it("403s on a wrong token", async () => {
    expect((await get("/message?to=e2e%2Bvitest%400509.io", "wrong-token")).status).toBe(403);
  });

  it("403s on no Authorization header", async () => {
    const res = await worker.fetch(
      new Request("https://e2e-inbox.test/message?to=e2e%2Bvitest%400509.io"),
      env,
      createExecutionContext(),
    );
    expect(res.status).toBe(403);
  });

  it("400s without ?to=", async () => {
    expect((await get("/message")).status).toBe(400);
  });

  it("404s for a recipient with no stored message", async () => {
    expect((await get("/message?to=e2e%2Bnobody%400509.io")).status).toBe(404);
  });

  it("404s non-/message paths before checking the token", async () => {
    const res = await worker.fetch(
      new Request("https://e2e-inbox.test/"),
      { ...env, E2E_INBOX_TOKEN: undefined },
      createExecutionContext(),
    );
    expect(res.status).toBe(404);
  });

  it("503s naming the secret when E2E_INBOX_TOKEN is unset on the Worker", async () => {
    const res = await worker.fetch(
      new Request("https://e2e-inbox.test/message?to=e2e%2Bvitest%400509.io"),
      { ...env, E2E_INBOX_TOKEN: undefined },
      createExecutionContext(),
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("E2E_INBOX_TOKEN");
  });
});
