import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Regression: deploy-production run 33531233486 (2026-09-01, head
// 7fc115b9be2feda3165161e0295029c9acfe81f3) failed the prod-public e2e step
// with two request.get timeouts on `/llms.txt` (10s) and `/` (5s) and tripped
// FleetMainRed. Root cause: a fresh Worker at https://0509.io takes 5-10s to
// warm a cold route right after a main push; the global actionTimeout
// (10_000) and the explicit per-request timeout in the link-reachability
// helper (5_000) were tight enough to fail a green deploy on the very first
// cold hit. These assertions lock in the post-fix contract so the bug class
// cannot silently regress.

describe("prod-public e2e cold-start budget (issue #1529)", () => {
  const config = readFileSync("playwright.config.ts", "utf8");
  const spec = readFileSync("e2e/prod-public.spec.ts", "utf8");

  it("gives the prod-public project room for post-deploy cold start", () => {
    // The project must override the global 30s per-test budget AND the 10s
    // actionTimeout, otherwise a single cold route (llms.txt/robots.txt on a
    // freshly-deployed Worker) takes the whole suite down.
    expect(config).toMatch(
      /name:\s*"prod-public"[\s\S]*?timeout:\s*(?:60_000|90_000|120_000)/,
    );
    expect(config).toMatch(
      /name:\s*"prod-public"[\s\S]*?actionTimeout:\s*(?:20_000|30_000)/,
    );
    // The project must keep the production baseURL — a wrong fallback would
    // silently re-run the whole suite against the local dev server and the
    // test would "pass" while proving nothing about production.
    expect(config).toMatch(
      /name:\s*"prod-public"[\s\S]*?baseURL:\s*productionBaseURL/,
    );
  });

  it("warms the production Worker in test.beforeAll against a cold deploy", () => {
    // A bounded retry against /api/health gives the edge a few seconds to
    // warm before the suite starts measuring. The retry must be bounded so
    // a genuinely-down production still fails the run.
    expect(spec).toMatch(/test\.beforeAll\(/);
    expect(spec).toMatch(/PROD_PUBLIC_WARMUP_ATTEMPTS/);
    expect(spec).toMatch(/PROD_PUBLIC_WARMUP_BACKOFF_MS/);
    expect(spec).toMatch(/warmProductionBeforeAll/);
    expect(spec).toMatch(/api\/health/);
  });

  it("keeps every prod-public request.get timeout at or above the cold-start budget", () => {
    // The 5s and 10s timeouts the original spec shipped with (the inherited
    // actionTimeout for the bare request.get calls, and the explicit 5_000
    // inside expectPublicGetTargetReachable) are what caused the 2026-09-01
    // red. The post-fix contract: a single source of truth at >= 20s that
    // every request.get against production consults.
    expect(spec).toMatch(/PROD_PUBLIC_REQUEST_TIMEOUT_MS\s*=\s*(?:20_000|30_000)/);
    // The link-reachability helper must use the named constant, not a magic
    // 5_000, otherwise a future refactor can re-tighten the timeout without
    // anyone noticing the regression.
    expect(spec).toMatch(
      /expectPublicGetTargetReachable[\s\S]*?timeout:\s*PROD_PUBLIC_REQUEST_TIMEOUT_MS/,
    );
    // Every request.get against a production surface must thread the budget
    // explicitly so it cannot fall back to the project-level actionTimeout
    // the way the 2026-09-01 failure did. Multi-line argument lists defeat
    // a single-line regex, so look at the call sites by source-position:
    // the request.get line + its argument block (everything up to the next
    // blank line or closing semicolon at the same indent).
    const lines = spec.split("\n");
    const coldRoutes = ["/llms.txt", "/robots.txt", "/api/health"];
    // The auth loop is structured as
    //   for (const path of ["/auth/login", "/auth/signup"]) {
    //     const response = await request.get(new URL(path, baseURL)...
    // which means the URL literal lives two lines ABOVE the request.get call.
    const authPattern = /\[\s*"\/auth\/login"\s*,\s*"\/auth\/signup"\s*\]/;
    const inspected: { route: string; window: string }[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const m = line.match(/request\.get\(.*?(llms\.txt|robots\.txt|api\/health)/);
      if (!m) {
        // Catch the auth-loop body: the loop literal sits within 3 lines
        // before the request.get call, since the for-of body is tight.
        if (line.includes("request.get(") && i > 0 && authPattern.test(lines.slice(Math.max(0, i - 3), i + 1).join("\n"))) {
          const window = lines.slice(i, i + 6).join("\n");
          inspected.push({ route: "auth-loop", window });
          expect(
            window,
            "prod-public request.get inside the auth-loop must thread a timeout",
          ).toMatch(/timeout:\s*PROD_PUBLIC_REQUEST_TIMEOUT_MS/);
        }
        continue;
      }
      const window = lines.slice(i, i + 6).join("\n");
      const route = `/${m[1]}`;
      inspected.push({ route, window });
      expect(
        window,
        `prod-public request.get against ${m[1]} must thread a timeout`,
      ).toMatch(/timeout:\s*PROD_PUBLIC_REQUEST_TIMEOUT_MS/);
    }
    const routesHit = new Set(inspected.map((entry) => entry.route));
    // All single-call production routes must be present, and the auth-loop
    // call site (which iterates login + signup in one body) must be present
    // exactly once. This is a targeted guard against the regression class
    // without depending on the loop body being copy-pasted once per path.
    for (const route of coldRoutes) {
      expect(routesHit.has(route), `expected request.get against ${route}`).toBe(true);
    }
    expect(routesHit.has("auth-loop"), "expected the auth-loop request.get call site").toBe(true);
  });
});
