#!/usr/bin/env node
const baseUrl = process.env.PUBLIC_HOME_URL ?? "https://0509.in";
const staleSignals = [
  "The market moves after you log off",
  "After-hours market intelligence",
  "Enter pilot",
  "Intelligence room",
  "pricing-region",
  "Fraunces",
  "Manrope",
  "Rs 2,500",
  "Rs 7,500",
  "APP_REGION_DEFAULT",
  "Dodo preview",
  "Buyer currency is served from checkout preview.",
  "Prices are loaded from Dodo",
  "No unlimited claims",
  "Meta beta access",
  "Dodo price syncing",
  "Loading local monthly price",
  "Loading local annual price",
  "Loading local pack price",
  "market lanes watched",
  "source states separated",
  "source trail per move",
  "decision scan",
  "Start with Scout",
  "Proof-first monitoring",
];
const requiredSignals = [
  "Know when competitors change the offer.",
  "Stop finding out after the sales call.",
  "Recommended launch plan",
  "Start with Starter",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrls() {
  const plain = new URL("/", baseUrl);
  const busted = new URL("/", baseUrl);
  busted.searchParams.set("public-home-canary", `${Date.now()}`);
  return [plain, busted];
}

async function checkUrl(url) {
  const response = await fetch(url, {
    headers: {
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "0509-public-home-canary/1.0",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const html = await response.text();
  const cacheControl = response.headers.get("cache-control") ?? "";
  const cloudflareCacheControl = response.headers.get("cloudflare-cdn-cache-control") ?? "";
  const missing = requiredSignals.filter((signal) => !html.includes(signal));
  const stale = staleSignals.filter((signal) => html.includes(signal));
  const cacheSafe = cacheControl.includes("no-store") && cloudflareCacheControl.includes("no-store");

  return {
    url: url.toString(),
    ok: response.ok && missing.length === 0 && stale.length === 0 && cacheSafe,
    status: response.status,
    missing,
    stale,
    cacheControl,
    cloudflareCacheControl,
  };
}

async function run() {
  let lastResults = [];
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    lastResults = await Promise.all(buildUrls().map(checkUrl));
    if (lastResults.every((result) => result.ok)) {
      console.log("live public-home check passed");
      return;
    }
    await sleep(5_000);
  }

  console.error("live public-home check failed");
  console.error(JSON.stringify(lastResults, null, 2));
  process.exit(1);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
