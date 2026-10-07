import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../../workers/support-inbox";

/**
 * The support-inbox Email Worker (0509#4229 child 2): a delivered mail is
 * stored in support_report, forwarded to Nish, and opened as a GitHub issue
 * whose body carries only the report id, receipt time, 0509.io paths and the
 * mail client's user agent — never a line of the customer's text. Runs in
 * real workerd against real local D1 with migrations/ applied.
 */
type EmailMessage = Parameters<typeof worker.email>[0];
type InboxEnv = Parameters<typeof worker.email>[1];

/**
 * The runtime always hands a handler an ExecutionContext. The module's own
 * export type keeps each handler at the parameters it declares, so these
 * aliases carry the third argument the runtime passes and the handler ignores.
 */
const callFetch = worker.fetch as unknown as (
  request: Request,
  env: InboxEnv,
  ctx: ExecutionContext,
) => Promise<Response>;
const callEmail = worker.email as (message: EmailMessage, env: InboxEnv, ctx: ExecutionContext) => Promise<void>;

const ISSUES_URL = "https://api.github.com/repos/Nishfleet/0509/issues";

const MIME = [
  "From: Jane User <jane@customer.example>",
  "To: support+vitest@0509.io",
  "Subject: Refund please",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "I cannot sign in and my card was charged twice",
  "",
  "https://0509.io/app/pages?ref=mail",
].join("\r\n");

const fakeMessage = (forward: () => Promise<void>, mime = MIME, from = "jane@customer.example"): EmailMessage =>
  ({
    to: "support+vitest@0509.io",
    from,
    headers: new Headers({ subject: "Refund please", "user-agent": "Thunderbird 128" }),
    raw: new Response(mime).body,
    rawSize: mime.length,
    setReject: () => undefined,
    forward,
    reply: () => Promise.resolve(),
  }) as unknown as EmailMessage;

const deliver = async (inboxEnv: InboxEnv = env, mime = MIME, status = 201) => {
  const forward = vi.fn(() => Promise.resolve());
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status }));
  const ctx = createExecutionContext();
  await callEmail(fakeMessage(forward, mime), inboxEnv, ctx);
  await waitOnExecutionContext(ctx);
  return { forward, fetchSpy };
};

const issueBody = (fetchSpy: ReturnType<typeof vi.spyOn>) => {
  const init = fetchSpy.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)) as { title: string; body: string; labels: string[] };
};

describe("0509-support-inbox-v2", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM support_report");
    await env.DB.exec("DELETE FROM support_issue");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores the delivered mail as a support_report row", async () => {
    await deliver();

    const rows = await env.DB.prepare("SELECT raw, from_domain FROM support_report").all<{
      raw: string;
      from_domain: string;
    }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.raw).toBe(MIME);
    expect(rows.results[0]?.from_domain).toBe("customer.example");
  });

  it("forwards the mail to Nish", async () => {
    const { forward } = await deliver();

    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith("nishant345@gmail.com");
  });

  it("opens a machine-reported issue with the report id, site path and user agent", async () => {
    const { fetchSpy } = await deliver();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(ISSUES_URL);
    expect(init?.method).toBe("POST");

    const issue = issueBody(fetchSpy);
    const row = await env.DB.prepare("SELECT id FROM support_report").first<{ id: string }>();
    expect(issue.title).toBe(`user report ${row?.id ?? "<missing>"}`);
    expect(issue.labels).toEqual(["user-report", "machine-reported"]);
    expect(issue.body).toContain("/app/pages");
    expect(issue.body).toContain("Thunderbird 128");
  });

  it("carries no line of the customer's text into the issue body", async () => {
    const { fetchSpy } = await deliver();

    const issue = issueBody(fetchSpy);
    for (const line of MIME.split("\r\n")) {
      if (line.trim() === "") continue;
      expect(issue.body).not.toContain(line);
    }
    expect(issue.body).not.toContain("Refund please");
    expect(issue.body).not.toContain("?ref=mail");
  });

  it("drops unsubscribe, confirm, and auth token paths from the issue body", async () => {
    const tokenMime = [
      ...MIME.split("\r\n"),
      "https://0509.io/u/tok-zq9-unsub",
      "https://0509.io/v/tok-zq9-verify",
      "https://0509.io/api/auth/magic-link/verify?token=secret",
    ].join("\r\n");
    const { fetchSpy } = await deliver(env, tokenMime);

    const issue = issueBody(fetchSpy);
    expect(issue.body).not.toContain("/u/");
    expect(issue.body).not.toContain("/v/");
    expect(issue.body).not.toContain("/api/auth");
    expect(issue.body).not.toContain("tok-zq9-unsub");
    expect(issue.body).not.toContain("tok-zq9-verify");
    expect(issue.body).toContain("/app/pages");
  });

  it("counts the issues it opened, so a failed create leaves the slot free", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await deliver(env, MIME, 500);

    const afterFailure = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM support_report) AS reports, (SELECT COUNT(*) FROM support_issue) AS issues",
    ).first<{ reports: number; issues: number }>();
    expect(afterFailure?.reports).toBe(1);
    expect(afterFailure?.issues).toBe(0);

    for (let i = 0; i < 3; i += 1) {
      await deliver(env, MIME.replace("Refund please", `Refund please ${i}`));
    }

    const afterCreates = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM support_report) AS reports, (SELECT COUNT(*) FROM support_issue) AS issues",
    ).first<{ reports: number; issues: number }>();
    expect(afterCreates?.reports).toBe(4);
    expect(afterCreates?.issues).toBe(3);
  });

  it("frees the slot when the create throws instead of answering a status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(new Response("{}", { status: 201 }));
    const sendOne = async (mime = MIME) => {
      const ctx = createExecutionContext();
      await worker.email(
        fakeMessage(
          vi.fn(() => Promise.resolve()),
          mime,
        ),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);
    };

    await sendOne();
    await sendOne(MIME.replace("Refund please", "Refund please again"));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const stored = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM support_report) AS reports, (SELECT COUNT(*) FROM support_issue) AS issues",
    ).first<{ reports: number; issues: number }>();
    expect(stored?.reports).toBe(2);
    expect(stored?.issues).toBe(1);
  });

  it("opens at most 3 issues per sender domain per day and still stores every mail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));

    for (let i = 0; i < 5; i += 1) {
      const ctx = createExecutionContext();
      await callEmail(fakeMessage(vi.fn(() => Promise.resolve())), env, ctx);
      await waitOnExecutionContext(ctx);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM support_report").first<{
      n: number;
    }>();
    expect(count?.n).toBe(5);
  });

  it("opens at most 3 issues when 5 mails arrive at once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));

    const contexts = Array.from({ length: 5 }, () => createExecutionContext());
    await Promise.all(contexts.map((ctx) => worker.email(fakeMessage(vi.fn(() => Promise.resolve())), env, ctx)));
    for (const ctx of contexts) {
      await waitOnExecutionContext(ctx);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const stored = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM support_report) AS reports, (SELECT COUNT(*) FROM support_issue) AS issues",
    ).first<{ reports: number; issues: number }>();
    expect(stored?.reports).toBe(5);
    expect(stored?.issues).toBe(3);
  });

  it("opens at most 3 issues per sender domain per day when the last two mails arrive together", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));
    const sendOne = async () => {
      const ctx = createExecutionContext();
      await worker.email(fakeMessage(vi.fn(() => Promise.resolve())), env, ctx);
      await waitOnExecutionContext(ctx);
    };

    for (let i = 0; i < 3; i += 1) {
      await sendOne();
    }
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const contexts = Array.from({ length: 2 }, () => createExecutionContext());
    await Promise.all(contexts.map((ctx) => worker.email(fakeMessage(vi.fn(() => Promise.resolve())), env, ctx)));
    for (const ctx of contexts) {
      await waitOnExecutionContext(ctx);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const stored = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM support_report) AS reports, (SELECT COUNT(*) FROM support_issue) AS issues",
    ).first<{ reports: number; issues: number }>();
    expect(stored?.reports).toBe(5);
    expect(stored?.issues).toBe(3);
  });

  it("opens at most 20 issues a day across sender domains (0509#7084)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));

    for (let i = 0; i < 21; i += 1) {
      const from = `jane@d${String(i)}.example`;
      const mime = MIME.replace("jane@customer.example", from);
      const ctx = createExecutionContext();
      await worker.email(
        fakeMessage(
          vi.fn(() => Promise.resolve()),
          mime,
          from,
        ),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(20);
    const stored = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM support_report) AS reports, (SELECT COUNT(*) FROM support_issue) AS issues",
    ).first<{ reports: number; issues: number }>();
    expect(stored?.reports).toBe(21);
    expect(stored?.issues).toBe(20);
  });

  it("opens at most 20 issues across sender domains when the last two mails arrive together", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));
    const sendOne = async (from: string) => {
      const mime = MIME.replace("jane@customer.example", from);
      const ctx = createExecutionContext();
      await worker.email(
        fakeMessage(
          vi.fn(() => Promise.resolve()),
          mime,
          from,
        ),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);
    };

    for (let i = 0; i < 19; i += 1) {
      await sendOne(`jane@d${String(i)}.example`);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(19);

    const contexts = Array.from({ length: 2 }, (_, i) => ({
      ctx: createExecutionContext(),
      from: `jane@d${String(19 + i)}.example`,
    }));
    await Promise.all(
      contexts.map(({ ctx, from }) =>
        worker.email(
          fakeMessage(
            vi.fn(() => Promise.resolve()),
            MIME.replace("jane@customer.example", from),
            from,
          ),
          env,
          ctx,
        ),
      ),
    );
    for (const { ctx } of contexts) {
      await waitOnExecutionContext(ctx);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(20);
    const stored = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM support_report) AS reports, (SELECT COUNT(*) FROM support_issue) AS issues",
    ).first<{ reports: number; issues: number }>();
    expect(stored?.reports).toBe(21);
    expect(stored?.issues).toBe(20);
  });

  it("counts opened issues globally, so a failed create leaves the daily slot free", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValue(new Response("{}", { status: 201 }));
    const sendOne = async (from: string) => {
      const mime = MIME.replace("jane@customer.example", from);
      const ctx = createExecutionContext();
      await worker.email(
        fakeMessage(
          vi.fn(() => Promise.resolve()),
          mime,
          from,
        ),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);
    };

    await sendOne("jane@d0.example");
    for (let i = 1; i <= 20; i += 1) {
      await sendOne(`jane@d${String(i)}.example`);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(21);
    const stored = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM support_report) AS reports, (SELECT COUNT(*) FROM support_issue) AS issues",
    ).first<{ reports: number; issues: number }>();
    expect(stored?.reports).toBe(21);
    expect(stored?.issues).toBe(20);
  });

  it("still stores and forwards with no GitHub token, and never calls fetch", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { forward, fetchSpy } = await deliver({
      ...env,
      SUPPORT_INBOX_GITHUB_TOKEN: undefined,
    });

    const row = await env.DB.prepare("SELECT id FROM support_report").first<{ id: string }>();
    expect(row?.id).toBeTruthy();
    expect(forward).toHaveBeenCalledWith("nishant345@gmail.com");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("support-inbox: SUPPORT_INBOX_GITHUB_TOKEN is not set", row?.id);
  });

  it("answers 404 to a web request instead of throwing", async () => {
    const ctx = createExecutionContext();
    const response = await callFetch(new Request("https://inbox.example/"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(404);
  });
});
