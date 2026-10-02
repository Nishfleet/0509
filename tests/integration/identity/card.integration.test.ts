import { env, introspectWorkflow } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readCachedSiteProof, startCard } from "../../../app/lib/identity/card.server";
import { confirmCard } from "../../../app/lib/identity/confirm.server";
import { extractIdentity } from "../../../app/lib/identity/extract";
import { normaliseSubject } from "../../../app/lib/identity/normalise";
import { probeKey } from "../../../app/lib/identity/probe-cache.server";
import { classifyTailPages, identityTailInstanceId } from "../../../app/lib/identity/tail.server";
import { sha256Hex } from "../../../app/lib/sha256";
import { takeBrowserEscalation } from "../../../app/lib/site/browser-budget.server";
import gym from "../../fixtures/gymshark-2026-09-22-a.html?raw";

const NOW = "2026-09-24T00:00:00Z";
const LOGO_HOST = "images.ctfassets.net";

const BOT_GATED_HTML = `<!doctype html>
<html>
  <head>
    <title>Botgated</title>
    <meta property="og:description" content="A description that only the browser could read">
  </head>
  <body><h1>Botgated</h1></body>
</html>`;

function isLogo(url: string): boolean {
  return new URL(url).hostname === LOGO_HOST;
}

function subjectFor(input: string) {
  const normalised = normaliseSubject(input);
  if (!normalised.ok) throw new Error(`${input} must normalise`);
  return normalised.subject;
}

function stubWeb(homepage: (url: string) => Response) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (isLogo(url))
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }),
      );
    return Promise.resolve(homepage(url));
  });
  return calls;
}

interface BrowserStub {
  calls: string[];
  quickAction(action: "content", options: { url: string }): Promise<Response>;
}

function installBrowser(stub: BrowserStub): void {
  Object.defineProperty(env, "BROWSER", { configurable: true, value: stub });
}

function stubBrowser(html: string): BrowserStub {
  const calls: string[] = [];
  return {
    calls,
    quickAction(_action: "content", options: { url: string }): Promise<Response> {
      calls.push(options.url);
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, result: html, meta: { status: 200 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  };
}

async function settledTail(): Promise<void> {
  const row = await env.DB.prepare("SELECT id FROM entity WHERE workspace_id = 'ws-1' AND role = 'self'").first<{
    id: string;
  }>();
  if (row === null) return;
  const instance = await env.IDENTITY_TAIL.get(identityTailInstanceId(row.id));
  for (;;) {
    const status = await instance.status();
    if (status.status === "complete" || status.status === "errored") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function settledClassification(introspector: Awaited<ReturnType<typeof introspectWorkflow>>): Promise<void> {
  const [instance] = await introspector.get();
  if (instance === undefined) throw new Error("tail instance was not started");
  await instance.waitForStepResult({ name: "classify-pages" });
}

async function answerHomepage(): Promise<void> {
  await env.IDENTITY_CACHE.put(
    probeKey(subjectFor("gymshark.com"), "homepage"),
    JSON.stringify({
      name: "Gymshark",
      description: "Gym clothes",
      socials: [],
      logoCandidates: { ldOrganizationLogo: null, ogImage: null, appleTouchIcon: null },
      adLibraryHints: [],
      navLinks: [],
    }),
  );
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(async () => {
  const listed = await env.IDENTITY_CACHE.list();
  for (const key of listed.keys) await env.IDENTITY_CACHE.delete(key.name);
  const logos = await env.SNAPSHOTS.list({ prefix: "logo/" });
  for (const object of logos.objects) await env.SNAPSHOTS.delete(object.key);
  for (const table of ["entity", "takedown", "workspace", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u1', 'Owner', 'u1@0509.io', 0, ?, ?)`,
  )
    .bind(NOW, NOW)
    .run();
  await env.DB.prepare(`INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES ('ws-1', 'Owner', 'u1', ?)`)
    .bind(NOW)
    .run();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(env, "AI");
  Reflect.deleteProperty(env, "BROWSER");
});

describe("startCard", () => {
  function stubAi(p: number) {
    const run = vi.fn(() =>
      Promise.resolve({
        answers: {
          "identity_field_confidence.name": { type: "noul", noul: p },
          "identity_field_confidence.description": { type: "noul", noul: p },
          "identity_field_confidence.socials": { type: "noul", noul: p },
        },
      }),
    );
    Reflect.set(env, "AI", { run });
    return run;
  }

  it("draws the card from the brand's homepage", async () => {
    stubAi(0.95);
    stubWeb(() => new Response(gym, { status: 200 }));
    const card = startCard("ws-1", subjectFor("gymshark.com"), []);

    const site = await card.site;
    expect(site.name).toBe("Gymshark");
    expect(site.description).toContain("game-changing workout clothes");
    expect(site.socials.map((social) => social.platform)).toContain("instagram");
    expect(site.review).toEqual({ name: "fill", description: "fill", socials: "fill" });
    expect(site.unfound).toBe(false);
    expect(await card.logo).toBe("data:image/png;base64,AQID");
    expect(await env.SNAPSHOTS.get("logo/gymshark.com")).not.toBeNull();
  });

  function exampleHtml(head: string): string {
    return `<!doctype html>
<html>
  <head>
    <title>Example</title>
    ${head}
  </head>
  <body>
    <h1>Example</h1>
    <p>Example makes plain office chairs, desks and lamps for people who work
    from small rooms. Everything ships flat, assembles with one hex key, and
    comes in three colours. The catalogue is short on purpose: four chairs,
    two desks, one lamp, no limited editions and no collaborations.</p>
  </body>
</html>`;
  }

  function stubLogoFetch(homepageHtml: string, logos: Record<string, () => Response>) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      const respond = logos[url];
      if (respond !== undefined) return Promise.resolve(respond());
      return Promise.resolve(new Response(homepageHtml, { status: 200 }));
    });
    return calls;
  }

  it("skips an unsafe http og:image without fetching it and stores the DuckDuckGo icon", async () => {
    stubAi(0.95);
    const duckUrl = "https://icons.duckduckgo.com/ip3/example.com.ico";
    const calls = stubLogoFetch(exampleHtml('<meta property="og:image" content="http://insecure.example/og.png">'), {
      [duckUrl]: () =>
        new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }),
    });
    const card = startCard("ws-1", subjectFor("example.com"), []);
    await card.site;
    expect(await card.logo).toBe("data:image/png;base64,AQID");
    expect(calls.filter((url) => url === duckUrl)).toHaveLength(1);
    expect(calls).not.toContain("http://insecure.example/og.png");
    expect(await env.SNAPSHOTS.get("logo/example.com")).not.toBeNull();
  });

  it("re-probes past a stale icon entry that holds a URL the guarded fetch refuses", async () => {
    stubAi(0.95);
    // 0509#5890: a v1 entry cached the raw-fetch winner, so a URL storeLogo
    // refuses pinned a logo-less card for the probe TTL. v2 must not parse it.
    const staleUrl = "http://insecure.example/og.png";
    await env.IDENTITY_CACHE.put(probeKey(subjectFor("example.com"), "icon"), JSON.stringify({ url: staleUrl }));
    const duckUrl = "https://icons.duckduckgo.com/ip3/example.com.ico";
    const calls = stubLogoFetch(exampleHtml(""), {
      [duckUrl]: () =>
        new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }),
    });
    const card = startCard("ws-1", subjectFor("example.com"), []);
    await card.site;
    expect(await card.logo).toBe("data:image/png;base64,AQID");
    expect(calls).toContain(duckUrl);
    expect(calls).not.toContain(staleUrl);
  });

  it("stores the first candidate the guarded fetch keeps, and never reads a domain's og:image", async () => {
    stubAi(0.95);
    const ldUrl = `https://${LOGO_HOST}/ld.png`;
    const ogUrl = `https://${LOGO_HOST}/og.png`;
    const duckUrl = "https://icons.duckduckgo.com/ip3/example.com.ico";
    const calls = stubLogoFetch(
      exampleHtml(
        `<meta property="og:image" content="${ogUrl}">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Example","logo":"${ldUrl}"}</script>`,
      ),
      {
        [ldUrl]: () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
        [duckUrl]: () =>
          new Response(new Uint8Array([4, 5, 6]), { status: 200, headers: { "content-type": "image/png" } }),
      },
    );
    const card = startCard("ws-1", subjectFor("example.com"), []);
    await card.site;
    expect(await card.logo).toBe("data:image/png;base64,BAUG");
    expect(calls).toContain(ldUrl);
    expect(calls).not.toContain(ogUrl);
    expect(await env.SNAPSHOTS.get("logo/example.com")).not.toBeNull();
  });

  it("caches a versioned miss when every candidate fails the guarded fetch", async () => {
    stubAi(0.95);
    const subject = subjectFor("example.com");
    const ogUrl = `https://${LOGO_HOST}/og.png`;
    const duckUrl = "https://icons.duckduckgo.com/ip3/example.com.ico";
    const calls = stubLogoFetch(exampleHtml(`<meta property="og:image" content="${ogUrl}">`), {
      [duckUrl]: () => new Response(null, { status: 404 }),
    });
    const card = startCard("ws-1", subject, []);
    await card.site;
    expect(await card.logo).toBeNull();
    expect(calls).not.toContain(ogUrl);
    expect(calls).toContain(duckUrl);
    expect(await env.IDENTITY_CACHE.get(probeKey(subject, "icon"), "json")).toEqual({ v: 3, url: null });
  });

  it("reads the homepage once a day, not once per visit", async () => {
    stubAi(0.95);
    const calls = stubWeb(() => new Response(gym, { status: 200 }));
    await startCard("ws-1", subjectFor("gymshark.com"), []).site;
    await startCard("ws-1", subjectFor("https://www.gymshark.com/"), []).site;
    expect(calls.filter((url) => !isLogo(url))).toEqual(["https://gymshark.com/"]);
  });

  it("says nothing was found when the site cannot be read, and caches nothing", async () => {
    stubAi(0.95);
    stubWeb(() => new Response("blocked", { status: 403 }));
    const card = startCard("ws-1", subjectFor("unreachable.example"), []);
    expect(await card.site).toEqual({
      name: null,
      description: null,
      socials: [],
      review: { name: "empty", description: "empty", socials: "empty" },
      unfound: true,
    });
    expect(await card.logo).toBeNull();
    expect((await env.IDENTITY_CACHE.list()).keys).toEqual([]);
  });

  it("does not keep a read that found no name, description or socials", async () => {
    stubAi(0.95);
    const calls = stubWeb((url) =>
      url.startsWith("https://www.wikidata.org/")
        ? Response.json({ search: [] })
        : new Response(`<html><body>${"<p>stock text</p>".repeat(40)}</body></html>`, { status: 200 }),
    );
    const card = await startCard("ws-1", subjectFor("gymshark.com"), []).site;
    expect(card.unfound).toBe(true);
    expect((await env.IDENTITY_CACHE.list()).keys).toEqual([]);
    await startCard("ws-1", subjectFor("gymshark.com"), []).site;
    expect(calls.filter((url) => url === "https://gymshark.com/")).toHaveLength(2);
  });

  it("reads the site again when the kept card is empty", async () => {
    stubAi(0.95);
    await env.IDENTITY_CACHE.put(
      probeKey(subjectFor("gymshark.com"), "homepage"),
      JSON.stringify({
        name: null,
        description: null,
        socials: [],
        logoCandidates: { ldOrganizationLogo: null, ogImage: null, appleTouchIcon: null },
        adLibraryHints: [],
        navLinks: [],
      }),
    );
    stubWeb(() => new Response(gym, { status: 200 }));
    const site = await startCard("ws-1", subjectFor("gymshark.com"), []).site;
    expect(site.name).toBe("Gymshark");
    expect(site.unfound).toBe(false);
  });

  it("starts a creator's card from the handle, without reading any site", async () => {
    stubAi(0.95);
    const calls = stubWeb(() => new Response(gym, { status: 200 }));
    const site = await startCard("ws-1", subjectFor("https://www.tiktok.com/@gymshark"), []).site;
    expect(site).toEqual({
      name: "@gymshark",
      description: null,
      socials: [{ platform: "tiktok", url: "https://www.tiktok.com/@gymshark" }],
      review: { name: "fill", description: "empty", socials: "fill" },
      unfound: false,
    });
    expect(calls).toEqual([]);
  });

  it("draws a YouTube creator's card from the channel page", async () => {
    stubAi(0.95);
    const html = `<!doctype html>
<html>
  <head>
    <title>Gymshark - YouTube</title>
    <meta property="og:description" content="Official channel">
    <meta property="og:image" content="https://images.ctfassets.net/avatar.png">
  </head>
  <body>
    <a href="https://www.instagram.com/gymshark/">Instagram</a>
    <h1>Gymshark</h1>
    <p>Subscribe for workouts, training plans, athlete stories, product launches, and behind-the-scenes videos from the Gymshark team.</p>
    <p>Gymshark is a global athletic wear and fitness brand with training plans, workouts, and athlete stories on YouTube.</p>
  </body>
</html>`;
    stubWeb(() => new Response(html, { status: 200 }));
    const card = startCard("ws-1", subjectFor("https://www.youtube.com/@Gymshark"), []);
    const site = await card.site;
    expect(site.name).toBe("Gymshark");
    expect(site.description).toBe("Official channel");
    expect(site.socials.map((social) => social.platform)).toEqual(["youtube", "instagram"]);
    expect(site.review).toEqual({ name: "fill", description: "fill", socials: "fill" });
    expect(site.unfound).toBe(false);
    expect(await card.logo).toBe("data:image/png;base64,AQID");
    expect(await env.IDENTITY_CACHE.get("identity:gymshark:youtube-profile")).not.toBeNull();
  });

  it("falls back to the handle card when the Instagram profile cannot be read", async () => {
    stubAi(0.95);
    stubWeb(() => new Response("blocked", { status: 403 }));
    const card = startCard("ws-1", subjectFor("https://www.instagram.com/gymshark/"), []);
    const site = await card.site;
    expect(site.name).toBe("@gymshark");
    expect(site.description).toBeNull();
    expect(site.unfound).toBe(false);
    expect(await card.logo).toBeNull();
  });

  it("fills a bot-gated homepage through exactly one budgeted browser escalation", async () => {
    const subject = subjectFor("botgatedbudget.com");
    const day = new Date().toISOString().slice(0, 10);
    stubAi(0.95);
    stubWeb(() => new Response("blocked", { status: 403 }));
    const stub = stubBrowser(BOT_GATED_HTML);
    installBrowser(stub);

    const site = await startCard("ws-1", subject, []).site;

    expect(site.name).toBe("Botgated");
    expect(site.description).toBe("A description that only the browser could read");
    expect(site.unfound).toBe(false);
    expect(site.review).toEqual({ name: "fill", description: "fill", socials: "empty" });
    expect(stub.calls).toEqual(["https://botgatedbudget.com/"]);
    let left = 0;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      if (!(await takeBrowserEscalation("ws-1", subject.registrable, day))) break;
      left += 1;
    }
    expect(left).toBe(3);
  });

  it("escalates a bot-gated creator profile through the brand's budgeted read", async () => {
    const subject = subjectFor("https://www.instagram.com/botgatedprofile/");
    const day = new Date().toISOString().slice(0, 10);
    stubAi(0.95);
    stubWeb(() => new Response("blocked", { status: 403 }));
    const stub = stubBrowser(BOT_GATED_HTML);
    installBrowser(stub);

    const site = await startCard("ws-1", subject, []).site;

    expect(site.name).toBe("Botgated");
    expect(site.description).toBe("A description that only the browser could read");
    expect(site.unfound).toBe(false);
    expect(stub.calls).toEqual(["https://www.instagram.com/botgatedprofile/"]);
    let left = 0;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      if (!(await takeBrowserEscalation("ws-1", subject.registrable, day))) break;
      left += 1;
    }
    expect(left).toBe(3);
  });

  it("returns the unreached card without a browser call when the day's budget is spent", async () => {
    const subject = subjectFor("botgatedspent.com");
    const day = new Date().toISOString().slice(0, 10);
    let drained = 0;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      if (!(await takeBrowserEscalation("ws-1", subject.registrable, day))) break;
      drained += 1;
    }
    expect(drained).toBe(4);
    const calls = stubWeb(() => new Response("blocked", { status: 403 }));
    const stub = stubBrowser(BOT_GATED_HTML);
    installBrowser(stub);

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const card = startCard("ws-1", subject, []);

    expect(await card.site).toEqual({
      name: null,
      description: null,
      socials: [],
      review: { name: "empty", description: "empty", socials: "empty" },
      unfound: true,
    });
    expect(await card.logo).toBeNull();
    const events = log.mock.calls.map(([line]) => (JSON.parse(String(line)) as { event: string }).event);
    expect(events).toContain("identity-site-deferred");
    expect(events).not.toContain("identity-site-unreached");
    expect(stub.calls).toEqual([]);
    expect(calls).toEqual(["https://botgatedspent.com/"]);
    expect((await env.IDENTITY_CACHE.list()).keys).toEqual([]);
  });
});

// The four unreached lines carry the subject's hash, never the subject itself:
// #5786 took the `subject` key out, and the registrable domain still reached
// the same lines through the error message (0509#5847).
describe("the unreached log lines", () => {
  async function logged(run: () => Promise<unknown>): Promise<Record<string, unknown>[]> {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      lines.push(String(line));
    });
    try {
      await run();
    } finally {
      spy.mockRestore();
    }
    return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it("names the subject only as a hash, on a failed site probe", async () => {
    // A host tldts is not ICANN for is an invalid-url failure whose detail is
    // the hostname itself: the exact string #5786's name-based gate missed.
    const domain = "unreachablenotin-icann.invalid";

    const rows = await logged(() => startCard("ws-1", subjectFor(domain), []).site);

    expect(rows.find((row) => row.event === "identity-site-unreached")).toEqual({
      event: "identity-site-unreached",
      reason: "invalid-url",
      subjectSha256: await sha256Hex(domain),
    });
    expect(JSON.stringify(rows)).not.toContain(domain);
  });

  it("names the subject only as a hash, on a failed creator probe", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("connect ECONNREFUSED")));

    const rows = await logged(
      () => startCard("ws-1", subjectFor("https://www.instagram.com/unreachedcreator/"), []).site,
    );

    const unreached = rows.find((row) => row.event === "identity-creator-unreached");
    expect(unreached?.reason).toBe("unreachable");
    expect(unreached?.subjectSha256).toBe(await sha256Hex("unreachedcreator"));
    expect(JSON.stringify(rows)).not.toContain("unreachedcreator");
  });

  it("names the subject only as a hash, on a skipped page-role read", async () => {
    const domain = "skipper.invalid";

    const rows = await logged(() =>
      classifyTailPages(
        { workspaceId: "ws-1", entityId: "e1", name: "Skipper", domain, homepageUrl: `https://${domain}/` },
        NOW,
      ),
    );

    expect(rows.find((row) => row.event === "identity-page-role-skipped")).toEqual({
      event: "identity-page-role-skipped",
      workspaceId: "ws-1",
      reason: "invalid-url",
      subjectSha256: await sha256Hex(domain),
    });
    expect(JSON.stringify(rows)).not.toContain(domain);
  });

  it("names the reason, never the message, when the probe throws something else", async () => {
    // A readable page that carries no name, description or socials is not a
    // readUrl failure, so probeSite throws a plain Error: the branch the
    // reason classifier is there to name.
    const domain = "throwselsewhere.com";
    const anonymous = `<!doctype html>
<html><head><meta name="generator" content="none"></head>
<body><h1>Page</h1><p>${"This page is deliberately long enough to pass the thin-text refusal, ".repeat(6)}but names nobody, links to no social profile and carries no description for the card to read.</p></body></html>`;
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(anonymous, { status: 200 })));

    const rows = await logged(() => startCard("ws-1", subjectFor(domain), []).site);

    const unreached = rows.find((row) => row.event === "identity-site-unreached");
    expect(unreached?.reason).toBe("probe-failed");
    expect(unreached?.subjectSha256).toBe(await sha256Hex(domain));
    expect(JSON.stringify(rows)).not.toContain(domain);
  });
});

describe("confirmCard", () => {
  it("saves the card, with the user's edits, as the workspace's own brand", async () => {
    stubWeb(() => new Response(gym, { status: 200, headers: { "content-type": "text/html" } }));
    await answerHomepage();
    await env.SNAPSHOTS.put("logo/gymshark.com", new Uint8Array([1]), { httpMetadata: { contentType: "image/png" } });
    const saved = await confirmCard(
      "ws-1",
      "u1",
      form({
        subject: "https://www.gymshark.com/en-GB/",
        name: " Gymshark UK ",
        description: "Gym clothes",
        "social.instagram": "https://www.instagram.com/gymshark/",
      }),
    );
    expect(saved).toBe(true);

    const row = await env.DB.prepare(
      "SELECT role, domain, name, identity_json, origin, state, confirmed_at IS NOT NULL AS confirmed, id FROM entity",
    ).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      role: "self",
      domain: "gymshark.com",
      name: "Gymshark UK",
      origin: "manual",
      state: "on",
      confirmed: 1,
    });
    expect(JSON.parse(String(row?.identity_json))).toEqual({
      kind: "domain",
      platform: null,
      url: "https://www.gymshark.com/",
      description: "Gym clothes",
      logoUrl: "/app/logos/" + String(row?.id),
      socials: [{ platform: "instagram", url: "https://www.instagram.com/gymshark/" }],
    });
    await settledTail();
  });

  it("classifies the homepage's nav pages and writes them as judged page rows", async () => {
    stubWeb(() => new Response(gym, { status: 200, headers: { "content-type": "text/html" } }));
    await answerHomepage();
    const run = vi.fn(() => Promise.resolve({ answers: { page_role: { type: "choice", choice: "pricing" } } }));
    Reflect.set(env, "AI", { run });

    expect(
      await confirmCard(
        "ws-1",
        "u1",
        form({ subject: "https://www.gymshark.com/", name: "Gymshark", description: "" }),
      ),
    ).toBe(true);
    await settledTail();

    const entity = await env.DB.prepare("SELECT id FROM entity WHERE role = 'self'").first<{ id: string }>();
    const expected = (await extractIdentity(gym, "https://www.gymshark.com/")).navPages.length;
    expect(expected).toBeGreaterThan(0);

    const { results } = await env.DB.prepare(
      "SELECT role, role_decided_for_hash FROM page WHERE entity_id = ?1 AND role_decided_for_hash IS NOT NULL",
    )
      .bind(entity?.id ?? "")
      .all<{ role: string; role_decided_for_hash: string }>();
    expect(results).toHaveLength(expected);
    for (const page of results) expect(page.role).toBe("pricing");
  });

  it("spends the brand's browser budget on the brand, and stops escalating once it is gone", async () => {
    const domain = "botgatedconfirm.com";
    await using introspector = await introspectWorkflow(env.IDENTITY_TAIL);
    Reflect.set(env, "AI", { run: vi.fn(() => Promise.reject(new Error("down"))) });
    const day = new Date().toISOString().slice(0, 10);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(await takeBrowserEscalation("ws-1", domain, day)).toBe(true);
    }
    stubWeb(() => new Response("blocked", { status: 403 }));
    const stub = stubBrowser(BOT_GATED_HTML);
    installBrowser(stub);

    expect(await confirmCard("ws-1", "u1", form({ subject: domain, name: "Botgated Confirm", description: "" }))).toBe(
      true,
    );
    await settledClassification(introspector);

    expect(stub.calls).toEqual([]);
  });

  it("escalates a bot-gated confirm through the brand's last budgeted read", async () => {
    const domain = "botgatedconfirmpositive.com";
    await using introspector = await introspectWorkflow(env.IDENTITY_TAIL);
    Reflect.set(env, "AI", { run: vi.fn(() => Promise.reject(new Error("down"))) });
    const day = new Date().toISOString().slice(0, 10);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await takeBrowserEscalation("ws-1", domain, day)).toBe(true);
    }
    stubWeb(() => new Response("blocked", { status: 403 }));
    const stub = stubBrowser(BOT_GATED_HTML);
    installBrowser(stub);

    expect(await confirmCard("ws-1", "u1", form({ subject: domain, name: "Botgated Positive", description: "" }))).toBe(
      true,
    );
    await settledClassification(introspector);

    expect(stub.calls).toEqual([`https://${domain}/`]);
    let left = 0;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      if (!(await takeBrowserEscalation("ws-1", domain, day))) break;
      left += 1;
    }
    expect(left).toBe(0);
  });

  it("keys a creator's social site on the site's brand, not the fresh entity", async () => {
    const domain = "botgatedsocial.com";
    const day = new Date().toISOString().slice(0, 10);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await takeBrowserEscalation("ws-1", domain, day)).toBe(true);
    }
    stubWeb(() => new Response("blocked", { status: 403 }));
    const stub = stubBrowser(BOT_GATED_HTML);
    installBrowser(stub);

    expect(
      await confirmCard(
        "ws-1",
        "u1",
        form({
          subject: "https://www.instagram.com/botgatedcreator/",
          name: "Botgated Creator",
          description: "",
          "social.site": `https://${domain}/`,
        }),
      ),
    ).toBe(true);
    await settledTail();

    expect(stub.calls).toEqual([`https://${domain}/`]);
    let left = 0;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      if (!(await takeBrowserEscalation("ws-1", domain, day))) break;
      left += 1;
    }
    expect(left).toBe(0);
  });

  it("keeps the confirm and records no role when Jev is down", async () => {
    stubWeb(() => new Response(gym, { status: 200, headers: { "content-type": "text/html" } }));
    await answerHomepage();
    const run = vi.fn(() => Promise.reject(new Error("down")));
    Reflect.set(env, "AI", { run });

    expect(
      await confirmCard(
        "ws-1",
        "u1",
        form({ subject: "https://www.gymshark.com/", name: "Gymshark", description: "" }),
      ),
    ).toBe(true);
    await settledTail();

    const entity = await env.DB.prepare("SELECT id FROM entity WHERE role = 'self'").first<{ id: string }>();
    expect(entity).not.toBeNull();
    const { results } = await env.DB.prepare(
      "SELECT id FROM page WHERE entity_id = ?1 AND role_decided_for_hash IS NOT NULL",
    )
      .bind(entity?.id ?? "")
      .all();
    expect(results).toEqual([]);
  });

  it("ignores a form-supplied logo URL when no logo is kept in R2", async () => {
    stubWeb(() => new Response(gym, { status: 200, headers: { "content-type": "text/html" } }));
    await answerHomepage();
    const saved = await confirmCard(
      "ws-1",
      "u1",
      form({
        subject: "gymshark.com",
        name: "Gymshark",
        description: "Gym clothes",
        logo: "https://evil.example/x.png",
      }),
    );
    expect(saved).toBe(true);
    const row = await env.DB.prepare("SELECT identity_json FROM entity").first<Record<string, unknown>>();
    expect(JSON.parse(String(row?.identity_json)).logoUrl).toBeNull();
    await settledTail();
  });

  it("refuses a card with no name, and a second confirm keeps the first", async () => {
    stubWeb(() => new Response(gym, { status: 200, headers: { "content-type": "text/html" } }));
    await answerHomepage();
    expect(await confirmCard("ws-1", "u1", form({ subject: "gymshark.com", name: "  ", description: "" }))).toBe(false);
    expect(await confirmCard("ws-1", "u1", form({ subject: "gymshark.com", name: "First", description: "" }))).toBe(
      true,
    );
    expect(await confirmCard("ws-1", "u1", form({ subject: "gymshark.com", name: "Second", description: "" }))).toBe(
      true,
    );
    const { results } = await env.DB.prepare("SELECT name FROM entity").all();
    expect(results).toEqual([{ name: "First" }]);
    await settledTail();
  });

  it("refuses a social link that is not a URL", async () => {
    const saved = await confirmCard(
      "ws-1",
      "u1",
      form({ subject: "gymshark.com", name: "Gymshark", description: "", "social.x": "javascript:alert(1)" }),
    );
    expect(saved).toBe(false);
  });
});

describe("readCachedSiteProof", () => {
  const subject = subjectFor("proof-test.example");
  const key = probeKey(subject, "homepage");

  afterEach(async () => {
    await env.IDENTITY_CACHE.delete(key);
  });

  it("returns empty hints when the cache has no entry", async () => {
    await expect(readCachedSiteProof(subject)).resolves.toEqual({ adLibraryHints: [], navLinks: [] });
  });

  it("returns empty hints when the cached entry does not match the site card", async () => {
    await env.IDENTITY_CACHE.put(key, JSON.stringify({ name: 1 }));
    await expect(readCachedSiteProof(subject)).resolves.toEqual({ adLibraryHints: [], navLinks: [] });
  });

  it("returns empty hints when the cached entry is an unrelated object", async () => {
    await env.IDENTITY_CACHE.put(key, JSON.stringify({ bad: true }));
    await expect(readCachedSiteProof(subject)).resolves.toEqual({ adLibraryHints: [], navLinks: [] });
  });
});
