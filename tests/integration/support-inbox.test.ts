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

const fakeMessage = (forward: () => Promise<void>): EmailMessage =>
  ({
    to: "support+vitest@0509.io",
    from: "jane@customer.example",
    headers: new Headers({ subject: "Refund please", "user-agent": "Thunderbird 128" }),
    raw: new Response(MIME).body,
    rawSize: MIME.length,
    setReject: () => undefined,
    forward,
    reply: () => Promise.resolve(),
  }) as unknown as EmailMessage;

const deliver = async (inboxEnv: InboxEnv = env) => {
  const forward = vi.fn(() => Promise.resolve());
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}", { status: 201 }));
  const ctx = createExecutionContext();
  await worker.email(fakeMessage(forward), inboxEnv, ctx);
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores the delivered mail as a support_report row", async () => {
    await deliver();

    const rows = await env.DB
      .prepare("SELECT raw, from_domain FROM support_report")
      .all<{ raw: string; from_domain: string }>();
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
    expect(errorSpy).toHaveBeenCalledWith(
      "support-inbox: SUPPORT_INBOX_GITHUB_TOKEN is not set",
      row?.id,
    );
  });
});
