import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import worker, {
  WORKER_NAME,
  moveSupportRule,
  pathsInText,
  readSupportReport,
  type RoutingRule,
} from "../../workers/support-inbox";

/**
 * The support inbox in real workerd against a real local D1 with the
 * migrations applied. The GitHub call is stubbed. The assertion that
 * matters: no line of the raw mail appears in the issue body.
 */

type EmailMessage = Parameters<typeof worker.email>[0];

const CUSTOMER_LINE = "The checkout button did nothing and I was charged twice yesterday.";
const SUBJECT = "Charged twice on the standing card";
const FROM = "Ada Lovelace <ada.lovelace@example.com>";
const USER_AGENT = "Mozilla/5.0 (TestMail 1.0)";

const TEXT = [
  CUSTOMER_LINE,
  "support@0509.io",
  "https://0509.io/s/public-slug?utm=newsletter",
  "https://0509.io/api/auth/magic-link/verify?token=secret-token",
  "https://not0509.io/stolen",
  "https://0509.io.evil.com/also-stolen",
].join("\n");

const MIME = [
  `From: ${FROM}`,
  "To: support@0509.io",
  `Subject: ${SUBJECT}`,
  `User-Agent: ${USER_AGENT}`,
  "Content-Type: text/plain; charset=utf-8",
  "",
  TEXT,
].join("\r\n");

interface GithubCall {
  url: string;
  method: string;
  body: string | null;
  authorization: string | null;
}

function fakeMessage(raw: string, headers: Headers): EmailMessage {
  return {
    to: "support@0509.io",
    from: "ada.lovelace@example.com",
    headers,
    raw: new Response(raw).body,
    rawSize: raw.length,
    setReject: () => undefined,
    forward: () => Promise.resolve(),
    reply: () => Promise.resolve(),
  } as unknown as EmailMessage;
}

function mailHeaders(): Headers {
  return new Headers({
    from: FROM,
    subject: SUBJECT,
    "user-agent": USER_AGENT,
  });
}

function stubGithub() {
  const calls: GithubCall[] = [];
  let opened: string | null = null;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : null;
    const headers = new Headers(init?.headers);
    calls.push({ url, method, body, authorization: headers.get("authorization") });
    if (url.startsWith("https://api.github.com/search/issues")) {
      const items = opened ? [{ title: opened }] : [];
      return new Response(JSON.stringify({ items }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "https://api.github.com/repos/Nishfleet/0509/issues" && method === "POST") {
      opened = body ? ((JSON.parse(body) as { title?: string }).title ?? null) : null;
      return new Response("{}", { status: 201, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = real;
    },
  };
}

let restoreFetch: (() => void) | null = null;

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

async function deliver(raw: string, headers: Headers, inboxEnv: typeof env = env) {
  const ctx = createExecutionContext();
  await worker.email(fakeMessage(raw, headers), inboxEnv, ctx);
  await waitOnExecutionContext(ctx);
}

describe("pathsInText", () => {
  it("keeps 0509.io paths and drops the query string", () => {
    expect(
      pathsInText(
        "see https://0509.io/s/public-slug?token=secret and 0509.io/login. and https://www.0509.io/app",
      ),
    ).toEqual(["/s/public-slug", "/login", "/app"]);
  });

  it("ignores an address, a lookalike host, and userinfo", () => {
    expect(
      pathsInText(
        "support@0509.io https://not0509.io/x https://0509.io.evil.com/y https://user:pass@0509.io/secret",
      ),
    ).toEqual([]);
  });
});

describe(WORKER_NAME, () => {
  it("stores the raw row and opens an issue that contains no line of the mail", async () => {
    const github = stubGithub();
    restoreFetch = github.restore;
    await deliver(MIME, mailHeaders());

    const row = await env.DB.prepare(
      `SELECT id, received_at, from_domain, subject_sha256, raw FROM support_report WHERE raw = ?`,
    )
      .bind(MIME)
      .first<{
        id: string;
        received_at: number;
        from_domain: string;
        subject_sha256: string;
        raw: string;
      }>();
    expect(row).not.toBeNull();
    expect(row?.raw).toBe(MIME);
    expect(row?.from_domain).toBe("example.com");
    expect(row?.subject_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.subject_sha256).not.toBe(SUBJECT);
    const subjectHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SUBJECT));
    const subjectHex = [...new Uint8Array(subjectHash)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(row?.subject_sha256).toBe(subjectHex);

    const post = github.calls.find((call) => call.method === "POST");
    expect(post?.url).toBe("https://api.github.com/repos/Nishfleet/0509/issues");
    expect(post?.authorization).toBe("Bearer integration-token");
    const payload = JSON.parse(post?.body ?? "{}") as {
      title: string;
      body: string;
      labels: string[];
    };
    expect(payload.title).toBe(`user report ${row?.id}`);
    expect(payload.labels).toEqual(["user-report", "machine-reported"]);
    expect(payload.body).toContain(`id: ${row?.id}`);
    expect(payload.body).toContain(`received_at: ${new Date(Number(row?.received_at)).toISOString()}`);
    expect(payload.body).toContain("- /s/public-slug");
    expect(payload.body).toContain("- /api/auth/magic-link/verify");
    expect(payload.body).toContain(`user_agent: ${USER_AGENT}`);
    expect(payload.body).not.toContain("secret-token");
    expect(payload.body).not.toContain("utm=newsletter");
    expect(payload.body).not.toContain("ada.lovelace");
    expect(payload.body).not.toContain(SUBJECT);
    expect(payload.body).not.toContain("example.com");
    for (const line of MIME.split(/\r?\n/)) {
      if (line.trim().length > 0) expect(payload.body).not.toContain(line);
    }
    const visible = await readSupportReport(env.DB, row?.id ?? "", Date.now());
    expect(visible?.raw).toBe(MIME);
  });

  it("does not open a second issue when the same mail is delivered again", async () => {
    const github = stubGithub();
    restoreFetch = github.restore;
    const raw = MIME.replace(CUSTOMER_LINE, `${CUSTOMER_LINE} retry`);
    const headers = mailHeaders();
    await deliver(raw, headers);
    await deliver(raw, headers);
    const posts = github.calls.filter((call) => call.method === "POST");
    expect(posts).toHaveLength(1);
  });

  it("stores the row and throws when the GitHub token is unset", async () => {
    let called = false;
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("no");
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = real;
    };
    const raw = MIME.replace(CUSTOMER_LINE, `${CUSTOMER_LINE} missing-token`);
    await expect(
      deliver(raw, mailHeaders(), { ...env, SUPPORT_INBOX_GITHUB_TOKEN: undefined }),
    ).rejects.toThrow(/SUPPORT_INBOX_GITHUB_TOKEN/);
    expect(called).toBe(false);
    const row = await env.DB.prepare(`SELECT raw FROM support_report WHERE raw = ?`).bind(raw).first<{
      raw: string;
    }>();
    expect(row?.raw).toBe(raw);
  });

  it("hides a row older than 90 days on read and the nightly delete removes it", async () => {
    const github = stubGithub();
    restoreFetch = github.restore;
    const raw = MIME.replace(CUSTOMER_LINE, `${CUSTOMER_LINE} expired`);
    await deliver(raw, mailHeaders());
    const fresh = MIME.replace(CUSTOMER_LINE, `${CUSTOMER_LINE} fresh`);
    await deliver(fresh, mailHeaders());
    const old = await env.DB.prepare(`SELECT id FROM support_report WHERE raw = ?`).bind(raw).first<{
      id: string;
    }>();
    const kept = await env.DB.prepare(`SELECT id FROM support_report WHERE raw = ?`)
      .bind(fresh)
      .first<{ id: string }>();
    expect(old?.id).toBeTruthy();
    await env.DB.prepare(`UPDATE support_report SET received_at = ? WHERE id = ?`).bind(1, old?.id).run();
    expect(await readSupportReport(env.DB, old?.id ?? "", Date.now())).toBeNull();
    const ctx = createExecutionContext();
    await worker.scheduled({ cron: "0 0 * * *", scheduledTime: Date.now() }, env, ctx);
    await waitOnExecutionContext(ctx);
    const gone = await env.DB.prepare(`SELECT id FROM support_report WHERE id = ?`)
      .bind(old?.id)
      .first();
    expect(gone).toBeNull();
    expect((await readSupportReport(env.DB, kept?.id ?? "", Date.now()))?.raw).toBe(fresh);
  });

  it("answers HTTP with 404", async () => {
    const response = await worker.fetch(
      new Request("https://support-inbox.test/"),
      env,
      createExecutionContext(),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("not found");
  });
});

describe("moveSupportRule", () => {
  it("moves only the support@0509.io rule", () => {
    const rules: RoutingRule[] = [
      {
        matchers: [{ type: "literal", field: "to", value: "e2e@0509.io" }],
        actions: [{ type: "worker", value: ["0509-e2e-inbox"] }],
      },
      {
        matchers: [{ type: "literal", field: "to", value: "fleet-signup@0509.io" }],
        actions: [{ type: "worker", value: ["0509-support-inbox"] }],
      },
      {
        matchers: [{ type: "literal", field: "to", value: "alerts@0509.io" }],
        actions: [{ type: "worker", value: ["0509-support-inbox"] }],
      },
      {
        matchers: [{ type: "literal", field: "to", value: "owner@0509.io" }],
        actions: [{ type: "forward", value: ["owner@example.com"] }],
      },
      {
        matchers: [{ type: "all" }],
        actions: [{ type: "worker", value: ["0509-support-inbox"] }],
      },
      {
        matchers: [{ type: "literal", field: "to", value: "support@0509.io" }],
        actions: [{ type: "worker", value: ["0509-support-inbox"] }],
      },
    ];
    const next = moveSupportRule(rules, WORKER_NAME);
    expect(next[5]?.actions).toEqual([{ type: "worker", value: [WORKER_NAME] }]);
    expect(next[5]).not.toBe(rules[5]);
    for (const index of [0, 1, 2, 3, 4]) {
      expect(next[index]).toBe(rules[index]);
    }
  });
});
