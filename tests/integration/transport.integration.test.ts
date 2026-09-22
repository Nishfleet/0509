import { describe, expect, it } from "vitest";

import { fetchPage, type BrowserBinding } from "../../app/lib/fetch/transport";

const RICH = `<html><body>${"real visible copy. ".repeat(30)}</body></html>`;
const THIN = `<html><body>Just a moment…</body></html>`;

describe("fetchPage transport (#3885 P3)", () => {
  it("serves a healthy page via plain fetch, never touches the browser", async () => {
    let browserCalls = 0;
    const browser: BrowserBinding = {
      async quickAction() {
        browserCalls++;
        return new Response(JSON.stringify({ success: true, result: RICH }), { status: 200 });
      },
    };
    const res = await fetchPage("https://example.test/", browser, async () => new Response(RICH, { status: 200 }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.transport).toBe("fetch");
      expect(res.status).toBe(200);
      expect(res.browserMsUsed).toBeNull();
    }
    expect(browserCalls).toBe(0);
  });

  it("escalates to the browser once on a refused fetch", async () => {
    let browserCalls = 0;
    const browser: BrowserBinding = {
      async quickAction(_action, opts) {
        browserCalls++;
        expect(opts.url).toBe("https://blocked.test/");
        return new Response(JSON.stringify({ success: true, result: RICH }), {
          status: 200,
          headers: { "X-Browser-Ms-Used": "8123" },
        });
      },
    };
    const res = await fetchPage("https://blocked.test/", browser, async () => new Response("forbidden", { status: 403 }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.transport).toBe("browser");
      expect(res.browserMsUsed).toBe(8123);
    }
    expect(browserCalls).toBe(1);
  });

  it("escalates on a thin challenge body (<200 chars visible)", async () => {
    const browser: BrowserBinding = {
      async quickAction() {
        return new Response(JSON.stringify({ success: true, result: RICH }), { status: 200 });
      },
    };
    const res = await fetchPage("https://challenge.test/", browser, async () => new Response(THIN, { status: 200 }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.transport).toBe("browser");
  });

  it("returns a typed failure when both legs fail — never throws", async () => {
    const res = await fetchPage(
      "https://dead.test/",
      { async quickAction() { return new Response("boom", { status: 503 }); } },
      async () => new Response("no", { status: 502 }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("browser-503");
  });
});
