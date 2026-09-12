// #3308 acceptance proof: two consecutive anonymous GETs of https://0509.io/
// — the same shape proveEdgeCacheHit now requires (x-0509 stamp + zone HIT).
const url = new URL("https://0509.io/");
const probes = [];
for (let i = 0; i < 2; i += 1) {
  const started = performance.now();
  const response = await fetch(url, { headers: { "user-agent": "0509-3308-verification/1.0" } });
  const ttfb = Math.round(performance.now() - started);
  await response.text();
  probes.push({
    request: i + 1,
    x0509: response.headers.get("x-0509-edge-cache") ?? "none",
    cfCacheStatus: (response.headers.get("cf-cache-status") ?? "").trim().toUpperCase() || "NONE",
    cacheControl: response.headers.get("cache-control") ?? "",
    setCookie: response.headers.has("set-cookie"),
    ttfbMs: ttfb,
  });
}
console.log(JSON.stringify(probes, null, 2));
const second = probes[1];
console.log(
  second.cfCacheStatus === "HIT" && second.x0509 === "HIT"
    ? `PASS: second-request zone HIT (${second.ttfbMs}ms TTFB)`
    : `FAIL: second probe = ${second.cfCacheStatus}/${second.x0509}`,
);
