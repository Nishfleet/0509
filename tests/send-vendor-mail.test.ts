import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  appendReceipt,
  formatReceipt,
  main,
  parseDoc,
  sendMail,
} from "../scripts/send-vendor-mail.mjs";

// Fixture mirrors the real doc convention: "## Ready-to-send ..." section
// with To/From/Subject headers and a `>` blockquote body.
const ADSTACK_FIXTURE = `# Vendor listing

## Ready-to-send submission (the whole submission is one email)

To: \`hello@ad-stack.ai\`
From: \`support@0509.io\` (send when the owner gives the word)
Subject: \`Tool for your ad-intelligence ranking: Five to Nine (competitor ad monitoring, with evidence)\`

> Hi ad-stack team,
>
> Tool for your ad intelligence coverage: **Five to Nine**
> (https://0509.io) — competitor ad and landing-page monitoring.
>

## Something else

Subject: \`decoy subject that must not be picked up\`
`;

// Segwise-style doc: Subject present, no To: line (LinkedIn delivery).
const SEGWISE_FIXTURE = `# Segwise pitch

## Ready-to-send pitch (the whole submission is one message)

Subject: \`Tool for your ad-spy roundup: Five to Nine (competitor ad monitoring with proof)\`

> Hi Angad,
>
> Tool suggestion for your roundup: **Five to Nine** (https://0509.io).
>
`;

describe("parseDoc", () => {
  it("parses to/from/subject/body from the ready-to-send section", () => {
    const parsed = parseDoc(ADSTACK_FIXTURE);
    expect(parsed.errors).toBeUndefined();
    expect(parsed.to).toBe("hello@ad-stack.ai");
    expect(parsed.from).toBe("support@0509.io");
    expect(parsed.subject).toBe(
      "Tool for your ad-intelligence ranking: Five to Nine (competitor ad monitoring, with evidence)",
    );
    // Body is plain text: blockquote markers stripped, bold markers stripped,
    // and the decoy Subject line outside the section is NOT the subject.
    expect(parsed.body).toContain("Hi ad-stack team,");
    expect(parsed.body).toContain("Five to Nine");
    expect(parsed.body).not.toContain("**");
    expect(parsed.subject).not.toContain("decoy");
  });

  it("reports a clear error when To: is missing (segwise-style doc)", () => {
    const parsed = parseDoc(SEGWISE_FIXTURE);
    expect(parsed.errors).toBeDefined();
    expect(parsed.errors.join("\n")).toMatch(/no `To:` header/);
  });
});

describe("dry-run path (no network)", () => {
  it("prints the parsed email and never touches the network or the doc", async () => {
    const fetchImpl = vi.fn(() => {
      throw new Error("network must not be touched on the dry-run path");
    });
    const lines: string[] = [];
    const stdout = (s: string) => lines.push(s);
    const readFile = vi.fn(() => ADSTACK_FIXTURE);
    const code = await main(["--dry-run", "--doc", "docs/adstack-listing-2026-08-11.md"], {
      stdout,
      readFile,
      fetchImpl,
    });
    expect(code).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledTimes(1); // doc read once, never written
    expect(lines[0]).toMatch(/^DRY-RUN/);
    expect(lines.join("\n")).toContain("to:      hello@ad-stack.ai");
    expect(lines.join("\n")).toContain("Hi ad-stack team,");
  });

  it("does not write a receipt on the dry-run path", async () => {
    const writeFile = vi.fn(() => {
      throw new Error("dry-run path must not write");
    });
    const code = await main(["--doc", "docs/x.md"], {
      stdout: () => {},
      readFile: () => ADSTACK_FIXTURE,
      writeFile,
      fetchImpl: () => {
        throw new Error("no network");
      },
    });
    expect(code).toBe(0);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("fails with a clear error when the doc has no To: and no --to override", async () => {
    const lines: string[] = [];
    const code = await main(["--doc", "docs/segwise-listing-2026-08-21.md"], {
      stdout: (s: string) => lines.push(s),
      readFile: () => SEGWISE_FIXTURE,
      fetchImpl: () => {
        throw new Error("no network");
      },
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toMatch(/no `To:` header/);
  });

  it("resolves a missing To: header with an explicit --to override (segwise edge)", async () => {
    // The script header documents this exact case: segwise's recommended
    // delivery is LinkedIn, so the doc has no To: line — --to supplies it.
    const fetchImpl = vi.fn(() => {
      throw new Error("network must not be touched on the dry-run path");
    });
    const lines: string[] = [];
    const code = await main(
      ["--dry-run", "--to", "someone@segwise.ai", "--doc", "docs/segwise-listing-2026-08-21.md"],
      { stdout: (s: string) => lines.push(s), readFile: () => SEGWISE_FIXTURE, fetchImpl },
    );
    expect(code).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("to:      someone@segwise.ai (--to override)");
    expect(lines.join("\n")).toContain("Tool suggestion for your roundup");
  });

  it("a --to override does NOT mask a missing Subject", async () => {
    const noSubject = SEGWISE_FIXTURE.replace(/^Subject:.*$/m, "");
    const lines: string[] = [];
    const code = await main(["--to", "someone@segwise.ai", "--doc", "docs/x.md"], {
      stdout: (s: string) => lines.push(s),
      readFile: () => noSubject,
      fetchImpl: () => {
        throw new Error("no network");
      },
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toMatch(/no `Subject:` header/);
  });

  it("refuses --send and --dry-run together regardless of flag order", async () => {
    for (const argv of [
      ["--send", "--dry-run", "--doc", "docs/x.md"],
      ["--dry-run", "--send", "--doc", "docs/x.md"],
    ]) {
      const lines: string[] = [];
      const code = await main(argv, {
        stdout: (s: string) => lines.push(s),
        readFile: () => ADSTACK_FIXTURE,
        fetchImpl: () => {
          throw new Error("must never be reached");
        },
      });
      expect(code).toBe(2);
      expect(lines.join("\n")).toMatch(/pass either --send or --dry-run, not both/);
    }
  });

  it("restricts --doc to files under docs/", async () => {
    for (const doc of ["app/lib/foo.md", "../etc/passwd.md", "docs"]) {
      const lines: string[] = [];
      const code = await main(["--doc", doc], {
        stdout: (s: string) => lines.push(s),
        readFile: () => {
          throw new Error("must not read outside docs/");
        },
      });
      expect(code).toBe(2);
      expect(lines.join("\n")).toMatch(/--doc must point at a file under docs\//);
    }
  });
});

describe("receipt formatting", () => {
  const receipt = formatReceipt({
    timestamp: "2026-09-09T12:00:00.000Z",
    to: "hello@ad-stack.ai",
    from: "support@0509.io",
    subject: "Tool for your ad-intelligence ranking",
    httpStatus: 200,
    delivered: ["hello@ad-stack.ai"],
    queued: [],
    permanentBounces: [],
  });

  it("has a dated heading and records delivery status per recipient", () => {
    expect(receipt).toMatch(/^### Send receipt — 2026-09-09T12:00:00\.000Z$/m);
    expect(receipt).toContain("**To:** hello@ad-stack.ai");
    expect(receipt).toContain("**Delivered:** hello@ad-stack.ai");
    expect(receipt).toContain("**Queued:** none");
    expect(receipt).toContain("**HTTP status:** 200");
  });

  it("appends under an existing ## Receipts section", () => {
    const writes: Array<{ path: string; content: string }> = [];
    const rf = () => "# Doc\n\n## Receipts\n\n### Send receipt — earlier\n";
    const wf = (path: string, content: string) => writes.push({ path, content });
    appendReceipt("docs/adstack.md", receipt, { readFileSync: rf, writeFileSync: wf });
    expect(writes).toHaveLength(1);
    const next = writes[0].content;
    expect(next).toMatch(/^## Receipts$/m);
    // new receipt goes inside the section, after the heading but keeps the old one
    expect(next.indexOf("2026-09-09T12:00:00.000Z")).toBeLessThan(
      next.indexOf("earlier"),
    );
  });

  it("creates a ## Receipts section when the doc has none", () => {
    const rf = () => "# Doc\n\nNo receipts yet.\n";
    const writes: string[] = [];
    appendReceipt("docs/adstack.md", receipt, {
      readFileSync: rf,
      writeFileSync: (_p, c) => writes.push(c as string),
    });
    expect(writes[0]).toContain("## Receipts\n\n### Send receipt — 2026-09-09T12:00:00.000Z");
  });
});

describe("real send (--send)", () => {
  const env = { CLOUDFLARE_API_TOKEN: "test-token", CLOUDFLARE_ACCOUNT_ID: "test-account" };

  it("POSTs to the Email Sending REST API with the token in the header only", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: { delivered: ["hello@ad-stack.ai"], queued: [], permanent_bounces: [] },
        }),
        { status: 200 },
      ),
    );
    const written: string[] = [];
    const lines: string[] = [];
    const code = await main(["--send", "--doc", "docs/adstack.md"], {
      env,
      stdout: (s: string) => lines.push(s),
      readFile: () => ADSTACK_FIXTURE,
      writeFile: (_p: string, c: string) => written.push(c),
      fetchImpl,
    });
    expect(code).toBe(0);
    expect(written.join("\n")).toContain("### Send receipt");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/test-account/email/sending/send",
    );
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.to).toBe("hello@ad-stack.ai");
    expect(body.from).toEqual({ address: "support@0509.io" });
    expect(body.text).toContain("Hi ad-stack team,");
    // the token travels in the header, never in the body or printed output
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-token",
    });
    expect(lines.join("\n")).not.toContain("test-token");
    expect(lines.join("\n")).toContain("receipt appended");
  });

  it("fails without writing a receipt when credentials are missing", async () => {
    const fetchImpl = vi.fn();
    const lines: string[] = [];
    const code = await main(["--send", "--doc", "docs/adstack.md"], {
      env: {},
      stdout: (s: string) => lines.push(s),
      readFile: () => ADSTACK_FIXTURE,
      fetchImpl,
    });
    expect(code).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.join("\n")).toMatch(/missing credentials/);
  });

  it("fails without writing a receipt on an API error response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 1000, message: "Sender domain not verified" }],
        }),
        { status: 400 },
      ),
    );
    const lines: string[] = [];
    const code = await main(["--send", "--doc", "docs/adstack.md"], {
      env,
      stdout: (s: string) => lines.push(s),
      readFile: () => ADSTACK_FIXTURE,
      fetchImpl,
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toMatch(/send FAILED \(HTTP 400\)/);
    expect(lines.join("\n")).toContain("Sender domain not verified");
  });
});

describe("sendMail unit", () => {
  it("reports delivered/queued/permanent_bounces from the API result", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: { delivered: [], queued: ["a@b.c"], permanent_bounces: [] },
        }),
        { status: 200 },
      );
    const r = await sendMail(
      { to: "a@b.c", from: "support@0509.io", subject: "s", body: "b" },
      { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "acc" },
      fetchImpl,
    );
    expect(r.ok).toBe(true);
    expect(r.queued).toEqual(["a@b.c"]);
  });

  it("names a reason when the API returns 200 with no result payload", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ success: true, result: null }), { status: 200 });
    const r = await sendMail(
      { to: "a@b.c", from: "support@0509.io", subject: "s", body: "b" },
      { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "acc" },
      fetchImpl,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/HTTP 200 but no result payload/);
  });

  it("names a reason when the API returns 200 but nothing was delivered or queued", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: { delivered: [], queued: [], permanent_bounces: ["a@b.c"] },
        }),
        { status: 200 },
      );
    const r = await sendMail(
      { to: "a@b.c", from: "support@0509.io", subject: "s", body: "b" },
      { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "acc" },
      fetchImpl,
    );
    expect(r.ok).toBe(false);
    expect(r.permanentBounces).toEqual(["a@b.c"]);
    expect(r.errors.join("\n")).toMatch(/HTTP 200 but nothing was delivered or queued.*permanent_bounces: 1/s);
  });
});

describe("parseDoc against the real prepared docs (format-drift guard)", () => {
  const realDoc = (name: string) => readFileSync(new URL(`../docs/${name}`, import.meta.url), "utf8");

  it("adstack parses completely", () => {
    const p = parseDoc(realDoc("adstack-listing-2026-08-11.md"));
    expect(p.errors).toBeUndefined();
    expect(p.to).toBe("hello@ad-stack.ai");
    expect(p.from).toBe("support@0509.io");
  });

  it("adyntel fails closed: two emails share one ready-to-send section", () => {
    // The doc carries Email 1 (adyntel) and Email 2 (Trendtrack) under one
    // heading. First-match parsing would silently send only Email 1 — the
    // multi-header guard refuses instead.
    const p = parseDoc(realDoc("adyntel-listing-2026-08-21.md"));
    expect(p.errors?.join("\n")).toMatch(/multiple distinct To: headers/);
  });

  it("segwise fails on the missing To: only (subject + body parse fine)", () => {
    const p = parseDoc(realDoc("segwise-listing-2026-08-21.md"));
    expect(p.errors?.join("\n")).toMatch(/no `To:` header/);
    expect(p.errors?.join("\n")).not.toMatch(/multiple distinct/);
    expect(p.subject).toContain("ad-spy roundup");
    expect(p.body).toContain("Hi Angad,");
  });
});
