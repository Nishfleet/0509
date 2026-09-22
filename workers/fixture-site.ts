interface FixtureEnv {
  
  
  
  
  STATE: KVNamespace;
  FIXTURE_SITE_TOKEN?: string;
}

type BreakMode = "off" | "hard" | "soft";

const BREAK_KEY = "break-mode";

const isBreakMode = (value: string | null): value is BreakMode =>
  value === "off" || value === "hard" || value === "soft";

const timingSafeEqual = (
  crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
  }
).timingSafeEqual.bind(crypto.subtle);

const PRICING_SECTION = `    <section id="pricing" aria-labelledby="pricing-heading">
      <h2 id="pricing-heading">Pricing</h2>
      <ul>
        <li><strong>Starter</strong> &mdash; ₹499 / month</li>
        <li><strong>Pro</strong> &mdash; ₹1,299 / month</li>
        <li><strong>Team</strong> &mdash; ₹2,499 / month</li>
      </ul>
      <p><a href="https://0509.io/checkout?plan=pro" rel="nofollow">Choose a plan and check out</a></p>
    </section>`;

const renderPage = (mode: BreakMode): string => {
  const pricing = mode === "soft" ? "" : PRICING_SECTION;
  
  
  
  
  
  
  
  
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

async function flip(request: Request, env: FixtureEnv): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if (!env.FIXTURE_SITE_TOKEN) {
    
    
    
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
