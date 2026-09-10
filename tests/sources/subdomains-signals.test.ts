import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  classifySubdomain,
  fetchSubdomains,
} from "~/lib/sources/subdomains/subdomain-signals.server";

const notionFixture = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/crtsh/notion.json"), "utf-8"),
) as Array<{ name_value: string; not_before: string }>;

function mockFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("classifySubdomain", () => {
  it("classifies infrastructure labels as internal", () => {
    expect(classifySubdomain("dev.notion.so")).toBe("internal");
    expect(classifySubdomain("staging.notion.so")).toBe("internal");
    expect(classifySubdomain("stg.notion.so")).toBe("internal");
    expect(classifySubdomain("stage.notion.so")).toBe("internal");
    expect(classifySubdomain("test.notion.so")).toBe("internal");
    expect(classifySubdomain("qa.notion.so")).toBe("internal");
    expect(classifySubdomain("uat.notion.so")).toBe("internal");
    expect(classifySubdomain("sandbox.notion.so")).toBe("internal");
    expect(classifySubdomain("preview.notion.so")).toBe("internal");
    expect(classifySubdomain("internal.notion.so")).toBe("internal");
    expect(classifySubdomain("admin.notion.so")).toBe("internal");
    expect(classifySubdomain("vpn.notion.so")).toBe("internal");
    expect(classifySubdomain("mail.notion.so")).toBe("internal");
    expect(classifySubdomain("smtp.notion.so")).toBe("internal");
    expect(classifySubdomain("imap.notion.so")).toBe("internal");
    expect(classifySubdomain("autodiscover.notion.so")).toBe("internal");
    expect(classifySubdomain("cf.notion.so")).toBe("internal");
    expect(classifySubdomain("cdn1.notion.so")).toBe("internal");
    expect(classifySubdomain("ns1.notion.so")).toBe("internal");
    expect(classifySubdomain("mx1.notion.so")).toBe("internal");
    expect(classifySubdomain("_acme-challenge.notion.so")).toBe("internal");
  });

  it("classifies -dev/-stg/-staging/-prod suffix labels as internal", () => {
    expect(classifySubdomain("myapp-dev.notion.so")).toBe("internal");
    expect(classifySubdomain("myapp-stg.notion.so")).toBe("internal");
    expect(classifySubdomain("myapp-staging.notion.so")).toBe("internal");
    expect(classifySubdomain("myapp-prod.notion.so")).toBe("internal");
  });

  it("classifies product-facing labels as public", () => {
    expect(classifySubdomain("beta.notion.so")).toBe("public");
    expect(classifySubdomain("ai.notion.so")).toBe("public");
    expect(classifySubdomain("api.notion.so")).toBe("public");
    expect(classifySubdomain("app.notion.so")).toBe("public");
    expect(classifySubdomain("www.notion.so")).toBe("public");
  });
});

describe("fetchSubdomains", () => {
  it("normalizes: lowercase, strips *., splits newlines, drops apex and unrelated", async () => {
    const result = await fetchSubdomains("notion.so", mockFetch(notionFixture));
    if (result.unavailable) throw new Error("expected result");
    const names = result.names.map((n) => n.name);

    // Apex dropped
    expect(names).not.toContain("notion.so");
    // Unrelated domain dropped
    expect(names).not.toContain("unrelated.example.com");
    // Wildcard stripped
    expect(names).not.toContain("*.notion.so");
    // Wildcard target (notion.so from *.notion.so) is the apex — dropped
    // Newline-split entries present
    expect(names).toContain("dev.notion.so");
    expect(names).toContain("staging.notion.so");
    // Duplicates deduped (api.notion.so appears twice)
    expect(names.filter((n) => n === "api.notion.so")).toHaveLength(1);
  });

  it("keeps min(not_before) as firstSeen across duplicate entries", async () => {
    const result = await fetchSubdomains("notion.so", mockFetch(notionFixture));
    if (result.unavailable) throw new Error("expected result");
    const api = result.names.find((n) => n.name === "api.notion.so");
    // id 10 has not_before 2026-02-01, id 3 has 2026-03-01 — min is 2026-02-01
    expect(api?.firstSeen).toBe("2026-02-01T00:00:00.000Z");
  });

  it("classifies each name as internal or public", async () => {
    const result = await fetchSubdomains("notion.so", mockFetch(notionFixture));
    if (result.unavailable) throw new Error("expected result");
    const byName = new Map(result.names.map((n) => [n.name, n.kind]));
    expect(byName.get("dev.notion.so")).toBe("internal");
    expect(byName.get("staging.notion.so")).toBe("internal");
    expect(byName.get("mail.notion.so")).toBe("internal");
    expect(byName.get("ns1.notion.so")).toBe("internal");
    expect(byName.get("cdn1.notion.so")).toBe("internal");
    expect(byName.get("_acme-challenge.notion.so")).toBe("internal");
    expect(byName.get("myapp-dev.notion.so")).toBe("internal");
    expect(byName.get("beta.notion.so")).toBe("public");
    expect(byName.get("ai.notion.so")).toBe("public");
    expect(byName.get("api.notion.so")).toBe("public");
    expect(byName.get("app.notion.so")).toBe("public");
    expect(byName.get("www.notion.so")).toBe("public");
  });

  it("sorts names newest first by firstSeen", async () => {
    const result = await fetchSubdomains("notion.so", mockFetch(notionFixture));
    if (result.unavailable) throw new Error("expected result");
    for (let i = 1; i < result.names.length; i++) {
      expect(
        result.names[i].firstSeen.localeCompare(result.names[i - 1].firstSeen),
      ).toBeLessThanOrEqual(0);
    }
  });

  it("returns unavailable on HTTP 5xx", async () => {
    const result = await fetchSubdomains("notion.so", mockFetch([], 503));
    expect(result.unavailable).toBe(true);
    if (result.unavailable) expect(result.reason).toBe("http_503");
  });

  it("returns unavailable on non-JSON response", async () => {
    const badFetch = vi.fn(async () =>
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    ) as unknown as typeof fetch;
    const result = await fetchSubdomains("notion.so", badFetch);
    expect(result.unavailable).toBe(true);
    if (result.unavailable) expect(result.reason).toBe("non_json");
  });

  it("returns unavailable on fetch throw (timeout/network)", async () => {
    const throwingFetch = vi.fn(async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    const result = await fetchSubdomains("notion.so", throwingFetch);
    expect(result.unavailable).toBe(true);
    if (result.unavailable) expect(result.reason).toBe("fetch_failed");
  });

  it("returns unavailable when JSON is not an array", async () => {
    const result = await fetchSubdomains("notion.so", mockFetch({ error: "nope" }));
    expect(result.unavailable).toBe(true);
    if (result.unavailable) expect(result.reason).toBe("non_json");
  });

  it("returns empty names for an empty array response", async () => {
    const result = await fetchSubdomains("notion.so", mockFetch([]));
    if (result.unavailable) throw new Error("expected result");
    expect(result.names).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("returns unavailable for an empty domain", async () => {
    const result = await fetchSubdomains("  ", mockFetch([]));
    expect(result.unavailable).toBe(true);
  });

  it("caps at 5000 entries and records truncated: true", async () => {
    const big = Array.from({ length: 6000 }, (_, i) => ({
      name_value: `sub${i}.notion.so`,
      not_before: "2026-01-01T00:00:00.000Z",
    }));
    const result = await fetchSubdomains("notion.so", mockFetch(big));
    if (result.unavailable) throw new Error("expected result");
    expect(result.truncated).toBe(true);
    expect(result.names.length).toBeLessThanOrEqual(5000);
  });
});
