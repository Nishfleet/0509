interface FixtureEnv {
  // State lives in KV, not in code: the point of this Worker is that the break
  // is flip-pable at runtime from a live request, so the incident round-trip
  // (break -> fetch -> repair -> fetch) can be run for real against production
  // (docs/REBUILD-DONE.md J8, docs/engines/delivery.md P7.5).
  STATE: KVNamespace;
  FIXTURE_SITE_TOKEN?: string;
}

// The three break states, and the KV value that selects them. `off` is the
// healthy default — a missing KV key means `off`, so an empty namespace is a
// healthy site rather than a broken one.
type BreakMode = "off" | "hard" | "soft";

const BREAK_KEY = "break-mode";

const isBreakMode = (value: string | null): value is BreakMode =>
  value === "off" || value === "hard" || value === "soft";

// workerd's SubtleCrypto.timingSafeEqual — a synchronous constant-time
// compare. Same local declaration as the e2e inbox Worker: the DOM lib's
// SubtleCrypto declaration shadows the workers-types one under
// tsconfig.cloudflare.json, so the signature is restored here while the
// runtime call is the real one.
const timingSafeEqual = (
  crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
  }
).timingSafeEqual.bind(crypto.subtle);

// A pricing-shaped page: one h1, a pricing section with real price tokens and
// a checkout link. The soft break is "200 with this section gone", which is the
// case that actually exercises D3s — a missing priced section on a live page is
// a content regression, not a server error, and only a diff sees it.
const PRICING_SECTION = `    <section id="pricing" aria-labelledby="pricing-heading">
      <h2 id="pricing-heading">Pricing</h2>
      <ul>
        <li><strong>Starter</strong> &mdash; ₹499 / month</li>
        <li><strong>Pro</strong> &mdash; ₹1,299 / month</li>
        <li><strong>Team</strong> &mdash; ₹2,499 / month</li>
      </ul>
      <p><a href="https://0509.io/checkout?plan=pro" rel="nofollow">Choose a plan and check out</a></p>
    </section>`;
//
// NOTE: that href points at a URL the app does not serve yet (app/routes.ts has
// no /checkout route, J13 unbuilt), so it resolves 404 today. It is a markup
// marker on purpose, not a resolving target: D3s's "checkout link resolving"
// evidence (docs/engines/site-change.md) is computed against the live app and
// would read false in this fixture's healthy baseline, which would hand the
// judge evidence that cannot distinguish a healthy page from a broken one.
// When /checkout ships, point this at it and the marker becomes real.

const renderPage = (mode: BreakMode): string => {
  const pricing = mode === "soft" ? "" : PRICING_SECTION;
  // The mode is echoed in the body on purpose: an observer reading a 200 needs
  // to tell "healthy" from "soft-broken" without trusting a header. It is
  // aria-hidden because docs/engines/site-change.md:61 documents that the D3
  // hash is over normalised extracted text which DROPS aria-hidden elements —
  // a visible marker saying "mode: soft" lands in the exact text the judge
  // word-diffs, which announces the deliberate break and talks the fixture's
  // own incident out of firing. Outside the diff, the data-mode attribute is
  // still greppable by an operator.
  const marker =
    `    <p id="mode" data-mode="${mode}" aria-hidden="true">` +
    `fixture site, mode: ${mode}</p>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Five to Nine &mdash; fixture</title>
  </head>
  <body>
    <main>
      <h1>Track every competitor move, in one weekly brief</h1>
${marker}
${pricing}
    </main>
  </body>
</html>
`;
};

// No-store, on both the page and the flip response: the fixture's whole value
// is that a fresh fetch observes the current mode, so no zone Cache Rule or
// intermediate cache may answer a stale one.
const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/__break") {
      return flip(request, env);
    }

    const stored = await env.STATE.get(BREAK_KEY);
    const mode: BreakMode = isBreakMode(stored) ? stored : "off";

    if (mode === "hard") {
      return new Response("fixture site: hard break", {
        status: 500,
        headers: HTML_HEADERS,
      });
    }

    return new Response(renderPage(mode), { status: 200, headers: HTML_HEADERS });
  },
} satisfies ExportedHandler<FixtureEnv>;

// The flip route. Token-guarded, constant-time compared, and state-changing:
// POST only. A GET that mutated state would let a crawler or a prefetch break
// the fixture, which is the opposite of on-demand.
async function flip(request: Request, env: FixtureEnv): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if (!env.FIXTURE_SITE_TOKEN) {
    // Fail loudly, the same way the e2e inbox does: a missing secret must not
    // read as "no break", or a fixture that looks healthy because its token was
    // never set is worse than no fixture at all.
    return new Response("FIXTURE_SITE_TOKEN is not set on 0509-fixture-site", {
      status: 503,
    });
  }
  const presented = new TextEncoder().encode(request.headers.get("authorization") ?? "");
  const expected = new TextEncoder().encode(`Bearer ${env.FIXTURE_SITE_TOKEN}`);
  const match =
    presented.byteLength === expected.byteLength && timingSafeEqual(presented, expected);
  if (!match) {
    return new Response("forbidden", { status: 403 });
  }

  const requested = new URL(request.url).searchParams.get("mode");
  if (!isBreakMode(requested)) {
    return new Response("mode must be off, hard or soft", { status: 400 });
  }
  await env.STATE.put(BREAK_KEY, requested);
  return new Response(`break mode set to ${requested}`, { status: 200 });
}
