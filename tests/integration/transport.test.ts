import { afterEach, describe, expect, it, vi } from "vitest";

import { countExtractedChars, readUrl } from "../../app/lib/fetch/transport.server";

const browserHolder = vi.hoisted(() => ({
  current: undefined as
    | undefined
    | (BrowserStub & { calls: string[]; closed: number }),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    get BROWSER() {
      return browserHolder.current;
    },
  },
}));

interface BrowserStub {
  quickAction(
    action: "content",
    options: { url: string },
  ): Promise<Response>;
}

/**
 * The transport's job, pinned in real workerd rather than in a Node mock: a
 * plain `fetch` is tried first, and a site that refuses it still produces the
 * page because the reader escalates to Browser Rendering exactly once
 * (identity card P3, 0509#3971).
 *
 * The two legs are separated on purpose. The fetch leg runs against a stubbed
 * outbound `fetch` so every escalation trigger is reachable deterministically —
 * a real bot-gated site cannot be asked to gate on demand. The escalation leg
 * runs `readUrl` for real inside workerd and asserts the shape it must return,
 * including the `X-Browser-Ms-Used` value the cost model is priced from.
 *
 * What is NOT proven here, and cannot be: the real `env.BROWSER` binding. A
 * local workerd has no Browser Run service, so the binding is a stand-in that
 * records calls. The production escalation is evidenced in the PR body.
 */

/** A generous body, comfortably over the extracted-text floor. */
const SUBSTANTIAL_PAGE = `<!doctype html><html><head><title>Brand</title></head>
<body><h1>Gymshark</h1><p>${"Official site. ".repeat(40)}</p></body></html>`;

/** A challenge body under the text floor, with a recognised marker. */
const CHALLENGE_PAGE =
  `<!doctype html><html><body><h1>Just a moment...</h1>` +
  `<p>Checking if the site connection is secure</p></body></html>`;

/**
 * A stand-in for the Browser Run binding. It records every call so a test can
 * assert "exactly one escalation" rather than "at least one", and it exposes a
 * `close()` that fails loudly if the module ever reaches for the forbidden
 * browser lifecycle.
 */
function fakeBrowser(
  response:
    | { ok: true; html: string; status?: number; browserMs?: string }
    | { ok: false; throwOnCall?: boolean; status?: number },
): BrowserStub & { calls: string[]; closed: number } {
  const calls: string[] = [];
  const state = { closed: 0 };
  return {
    calls,
    get closed() {
      return state.closed;
    },
    async quickAction(_action: "content", options: { url: string }) {
      calls.push(options.url);
      if (!response.ok && response.throwOnCall) {
        throw new Error("browser run unavailable");
      }
      if (!response.ok) {
        return new Response("browser error", { status: response.status ?? 500 });
      }
      const headers = new Headers({ "content-type": "application/json" });
      if (response.browserMs !== undefined) {
        headers.set("X-Browser-Ms-Used", response.browserMs);
      }
      return new Response(
        JSON.stringify({
          success: true,
          result: response.html,
          meta: { status: response.status ?? 200 },
        }),
        { status: 200, headers },
      );
    },
    close() {
      state.closed += 1;
      return Promise.resolve();
    },
  };
}

function install(browser: BrowserStub & { calls: string[]; closed: number }) {
  browserHolder.current = browser;
}

afterEach(() => {
  vi.unstubAllGlobals();
  browserHolder.current = undefined;
});

/** Swap the outbound `fetch` for one that serves `handlers` by URL. */
function stubFetch(
  handlers: Record<string, () => Response | Promise<Response>>,
) {
  const real = globalThis.fetch;
  const seen: string[] = [];
  const inits: RequestInit[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    seen.push(url);
    if (init) inits.push(init);
    const handler = handlers[url];
    if (!handler) throw new Error(`unexpected outbound fetch: ${url}`);
    return handler();
  }) as typeof fetch;
  return { seen, inits, restore: () => (globalThis.fetch = real) };
}

describe("readUrl", () => {
  it("serves a healthy page over plain fetch and never touches the browser", async () => {
    const stub = stubFetch({
      "https://brand.example.com/": () =>
        new Response(SUBSTANTIAL_PAGE, { status: 200 }),
    });
    const browser = fakeBrowser({
      ok: true,
      html: SUBSTANTIAL_PAGE,
      browserMs: "1",
    });
    try {
      install(browser);
      const result = await readUrl("https://brand.example.com/");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transport).toBe("fetch");
      expect(result.status).toBe(200);
      expect(result.escalated).toBe(false);
      // The escalation's cost is not paid when the fetch stands.
      expect(result.browserMsUsed).toBeUndefined();
      expect(result.html).toBe(SUBSTANTIAL_PAGE);
      expect(typeof result.ms).toBe("number");
      expect(browser.calls).toEqual([]);
      expect(stub.inits).toHaveLength(1);
      expect(stub.inits[0]?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      stub.restore();
    }
  });

  it("bounds the plain fetch with AbortSignal.timeout(8000)", async () => {
    const stub = stubFetch({
      "https://brand.example.com/": () =>
        new Response(SUBSTANTIAL_PAGE, { status: 200 }),
    });
    const browser = fakeBrowser({ ok: true, html: SUBSTANTIAL_PAGE });
    const spy = vi.spyOn(AbortSignal, "timeout");
    try {
      install(browser);
      await readUrl("https://brand.example.com/");
      // The 8 s deadline from the packet, pinned: any other value would still
      // be an AbortSignal, so `instanceof` alone cannot catch a drift.
      expect(spy).toHaveBeenCalledWith(8000);
    } finally {
      stub.restore();
      spy.mockRestore();
    }
  });

  it("escalates on a non-2xx and returns the page with its browser-time cost", async () => {
    const stub = stubFetch({
      "https://gated.example.com/": () => new Response("Forbidden", { status: 403 }),
    });
    const browser = fakeBrowser({
      ok: true,
      html: SUBSTANTIAL_PAGE,
      status: 200,
      browserMs: "4123",
    });
    try {
      install(browser);
      const result = await readUrl("https://gated.example.com/");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transport).toBe("browser");
      expect(result.escalated).toBe(true);
      expect(result.status).toBe(200);
      // The number the cost model is priced from, read off the header.
      expect(result.browserMsUsed).toBe(4123);
      expect(result.html).toBe(SUBSTANTIAL_PAGE);
      expect(browser.calls).toEqual(["https://gated.example.com/"]);
    } finally {
      stub.restore();
    }
  });

  it("escalates on a challenge body served with a 200", async () => {
    const stub = stubFetch({
      "https://challenge.example.com/": () =>
        new Response(CHALLENGE_PAGE, { status: 200 }),
    });
    const browser = fakeBrowser({
      ok: true,
      html: SUBSTANTIAL_PAGE,
      browserMs: "3500",
    });
    try {
      install(browser);
      const result = await readUrl("https://challenge.example.com/");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The status alone cannot tell gated from served: this is a 200.
      expect(result.transport).toBe("browser");
      expect(result.status).toBe(200);
      expect(browser.calls).toHaveLength(1);
    } finally {
      stub.restore();
    }
  });

  it("escalates on a 200 whose extracted text is under the floor", async () => {
    const stub = stubFetch({
      "https://shell.example.com/": () =>
        new Response(
          `<!doctype html><html><body><div id="app"></div></body></html>`,
          { status: 200 },
        ),
    });
    const browser = fakeBrowser({
      ok: true,
      html: SUBSTANTIAL_PAGE,
      browserMs: "2000",
    });
    try {
      install(browser);
      const result = await readUrl("https://shell.example.com/");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transport).toBe("browser");
      expect(browser.calls).toHaveLength(1);
    } finally {
      stub.restore();
    }
  });

  it("escalates when the plain fetch times out", async () => {
    const stub = stubFetch({
      "https://slow.example.com/": () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
    });
    const browser = fakeBrowser({
      ok: true,
      html: SUBSTANTIAL_PAGE,
      browserMs: "5100",
    });
    try {
      install(browser);
      const result = await readUrl("https://slow.example.com/");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transport).toBe("browser");
      expect(browser.calls).toHaveLength(1);
    } finally {
      stub.restore();
    }
  });

  it("does not hand an unreachable host to the browser", async () => {
    const stub = stubFetch({
      "https://refused.example.com/": () => {
        throw new Error("connection refused");
      },
    });
    const browser = fakeBrowser({ ok: true, html: SUBSTANTIAL_PAGE });
    try {
      install(browser);
      const result = await readUrl("https://refused.example.com/");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("unreachable");
      expect(browser.calls).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  it.each([
    "http://foo.localhost/",
    "http://metadata.google.internal/",
    "http://printer.local/",
    "http://kubernetes.default.svc/",
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
  ])("refuses the non-public host %s before any outbound call", async (url) => {
    const stub = stubFetch({});
    const browser = fakeBrowser({ ok: true, html: SUBSTANTIAL_PAGE });
    try {
      install(browser);
      const result = await readUrl(url);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("invalid-url");
      expect(stub.seen).toEqual([]);
      expect(browser.calls).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  it("refuses a page that declares more than 5 MB without reading it", async () => {
    const stub = stubFetch({
      "https://huge.example.com/": () =>
        new Response("x", { status: 200, headers: { "content-length": "50000000" } }),
    });
    const browser = fakeBrowser({ ok: true, html: SUBSTANTIAL_PAGE });
    try {
      install(browser);
      const result = await readUrl("https://huge.example.com/");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("too-large");
      expect(browser.calls).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  it("stops reading a streamed page once it passes 5 MB", async () => {
    const chunk = new Uint8Array(1_000_000).fill(97);
    const stub = stubFetch({
      "https://endless.example.com/": () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(chunk);
            },
          }),
          { status: 200 },
        ),
    });
    const browser = fakeBrowser({ ok: true, html: SUBSTANTIAL_PAGE });
    try {
      install(browser);
      const result = await readUrl("https://endless.example.com/");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("too-large");
      expect(browser.calls).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  it("does exactly ONE escalation, then a typed failure — no retry loop", async () => {
    const stub = stubFetch({
      "https://gated.example.com/": () => new Response("Forbidden", { status: 403 }),
    });
    const browser = fakeBrowser({ ok: false, throwOnCall: true });
    try {
      install(browser);
      const result = await readUrl("https://gated.example.com/");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("escalation-failed");
      // One call, not two: the module must not retry.
      expect(browser.calls).toHaveLength(1);
    } finally {
      stub.restore();
    }
  });

  it("fails typed when the escalation answers non-ok", async () => {
    const stub = stubFetch({
      "https://gated.example.com/": () => new Response("Forbidden", { status: 403 }),
    });
    const browser = fakeBrowser({ ok: false, status: 429 });
    try {
      install(browser);
      const result = await readUrl("https://gated.example.com/");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("escalation-failed");
      expect(result.detail).toContain("browser answered 429");
      expect(browser.calls).toHaveLength(1);
    } finally {
      stub.restore();
    }
  });

  it("logs the escalation even when the browser call throws", async () => {
    const stub = stubFetch({
      "https://gated.example.com/": () => new Response("Forbidden", { status: 403 }),
    });
    const browser = fakeBrowser({ ok: false, throwOnCall: true });
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      lines.push(String(line));
    });
    try {
      install(browser);
      const result = await readUrl("https://gated.example.com/");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // The throw is the case the cost model most needs to see: an escalation
      // that ran out of browser capacity must still count.
      expect(result.detail).toContain("browser call threw");
      const escalation = lines
        .map((line) => JSON.parse(line) as { event?: string; browserMsUsed?: number | null })
        .find((row) => row.event === "browser-escalation");
      expect(escalation?.browserMsUsed).toBeNull();
    } finally {
      spy.mockRestore();
      stub.restore();
    }
  });

  it("rejects a malformed URL before any outbound call", async () => {
    const stub = stubFetch({});
    const browser = fakeBrowser({ ok: true, html: SUBSTANTIAL_PAGE });
    try {
      install(browser);
      const result = await readUrl("not a url");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("invalid-url");
      expect(stub.seen).toEqual([]);
      expect(browser.calls).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  it("rejects a non-http scheme", async () => {
    const stub = stubFetch({});
    const browser = fakeBrowser({ ok: true, html: SUBSTANTIAL_PAGE });
    try {
      install(browser);
      const result = await readUrl("ftp://brand.example.com/");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("invalid-url");
      expect(stub.seen).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  it("never calls browser.close(), even on a successful escalation", async () => {
    const stub = stubFetch({
      "https://gated.example.com/": () => new Response("Forbidden", { status: 403 }),
    });
    const browser = fakeBrowser({
      ok: true,
      html: SUBSTANTIAL_PAGE,
      browserMs: "1000",
    });
    try {
      install(browser);
      await readUrl("https://gated.example.com/");
      // A per-request close re-pays cold-launch seconds and burns the
      // 3-instances-per-second rate limit (REBUILD-STACK.md §4.3).
      expect(browser.closed).toBe(0);
    } finally {
      stub.restore();
    }
  });

  it("carries the escalation's page status, not the browser's own 200", async () => {
    const stub = stubFetch({
      "https://gated.example.com/": () => new Response("Forbidden", { status: 403 }),
    });
    const browser = fakeBrowser({
      ok: true,
      html: SUBSTANTIAL_PAGE,
      status: 404,
      browserMs: "900",
    });
    try {
      install(browser);
      const result = await readUrl("https://gated.example.com/");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.status).toBe(404);
    } finally {
      stub.restore();
    }
  });

  it("logs X-Browser-Ms-Used on every escalation", async () => {
    const stub = stubFetch({
      "https://gated.example.com/": () => new Response("Forbidden", { status: 403 }),
    });
    const browser = fakeBrowser({
      ok: true,
      html: SUBSTANTIAL_PAGE,
      browserMs: "4123",
    });
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      lines.push(String(line));
    });
    try {
      install(browser);
      await readUrl("https://gated.example.com/");
      const escalation = lines
        .map((line) => JSON.parse(line) as { event?: string; url?: string; browserMsUsed?: number })
        .find((row) => row.event === "browser-escalation");
      expect(escalation).toMatchObject({
        event: "browser-escalation",
        url: "https://gated.example.com/",
        browserMsUsed: 4123,
      });
    } finally {
      spy.mockRestore();
      stub.restore();
    }
  });

  it("logs an escalation whose browser header is absent, as null", async () => {
    const stub = stubFetch({
      "https://gated.example.com/": () => new Response("Forbidden", { status: 403 }),
    });
    const browser = fakeBrowser({ ok: true, html: SUBSTANTIAL_PAGE });
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      lines.push(String(line));
    });
    try {
      install(browser);
      const result = await readUrl("https://gated.example.com/");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.browserMsUsed).toBeUndefined();
      const escalation = lines
        .map((line) => JSON.parse(line) as { event?: string; browserMsUsed?: number | null })
        .find((row) => row.event === "browser-escalation");
      expect(escalation?.browserMsUsed).toBeNull();
    } finally {
      spy.mockRestore();
      stub.restore();
    }
  });
});

describe("countExtractedChars", () => {
  it("counts text nodes across chunks and skips non-rendering elements", async () => {
    const html =
      `<html><head><script>${"x".repeat(500)}</script>` +
      `<style>${"y".repeat(500)}</style></head>` +
      `<body><h1>Brand name</h1><p>${"z".repeat(300)}</p></body></html>`;
    // "Brand name" (10) + 300 z's; the script and style bodies do not count.
    expect(await countExtractedChars(html)).toBe(310);
  });

  it("returns a count under the floor for a JS shell", async () => {
    const html = `<!doctype html><html><body><div id="app"></div></body></html>`;
    expect(await countExtractedChars(html)).toBeLessThan(200);
  });

  it("keeps visible text that precedes an interleaved non-rendering element", async () => {
    const html =
      `<body><p>${"visible ".repeat(50)}</p>` +
      `<script>${"x".repeat(400)}</script>` +
      `<p>${"more text ".repeat(50)}</p></body>`;
    expect(await countExtractedChars(html)).toBe(900);
  });

  it("counts the 200-character floor boundary as served", async () => {
    const html = `<!doctype html><html><body><p>${"z".repeat(199)}</p></body></html>`;
    const thin = await countExtractedChars(html);
    const atFloor = await countExtractedChars(
      `<!doctype html><html><body><p>${"z".repeat(200)}</p></body></html>`,
    );
    expect(thin).toBe(199);
    expect(atFloor).toBe(200);
  });
});
