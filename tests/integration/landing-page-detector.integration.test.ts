import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractLandingPageSignals } from "~/lib/landing-page-signals.server";

import {
  appEnv,
  db,
  ISO_T0,
  seedAd,
  seedProofTarget,
  seedRun,
  seedUser,
  seedWatchlist,
  uid,
} from "./fixtures";

/**
 * Integration regression guard for issue #1500 — the landing-page
 * detector was silent for 77 days because the extraction pipeline
 * could bail at any of eight stages without per-stage telemetry. The
 * `lp_run_audit` instrumentation in
 * `app/lib/landing-page-run-audit.server.ts` plus the audit option on
 * `extractLandingPageSignals` must emit a `tag: "lp_run_audit"` JSON
 * line for every stage transition. This file asserts the wiring holds
 * across a curated 25-watchlist fixture set:
 *
 *   - Each watchlist's capture emits audit lines for the five
 *     extraction-owned stages (html_parse, anchor_resolve,
 *     cta_extract, price_extract, form_extract).
 *   - ≥20 of the 25 captures reach `cta_extract` with an `ok` or
 *     stable `bailed:<reason>` outcome — none crash, none go silent.
 *   - ≥1 of the 25 produces a real CTA value (the detector is not
 *     uniformly dead — there is at least one extraction path that
 *     succeeds end-to-end).
 *   - The audit stream never carries a stage other than the eight
 *     documented ones (operators can rely on a closed enum).
 *
 * The file is named `landing-page-detector.integration.test.ts` (not
 * `.spec.ts` as issue #1500 originally specified) so the repo's
 * existing vitest `workers` project picks it up without a config
 * change — `.spec.ts` is the Playwright convention, not vitest's.
 */

interface WatchlistFixture {
  watchlistId: string;
  runId: string;
  domain: string;
  html: string;
}

/**
 * 25 fixtures with varied shapes — a real landing page (CTA + price +
 * form), a pricing-only page (no form, no anchor), a navigation-only
 * page (anchor chrome, no CTA), a price-only page, an empty page, and
 * so on. The mix covers every bail-out reason the audit taxonomy
 * recognises.
 */
const FIXTURE_HTML_TEMPLATES: Array<string> = [
  // Real landing pages with a button-style CTA (priority verb fallback
  // matches).
  `<html><head><title>Glow Serum Sale</title></head><body><button>Buy now</button><span>$49.99</span><form><input type="email" name="email" /><button type="submit">Submit</button></form></body></html>`,
  `<html><head><title>Acme Pricing</title></head><body><a href="/shop">Buy now</a><span>$29</span><form><input type="email" name="email" /><button type="submit">Send</button></form></body></html>`,
  `<html><head><title>Five to Nine</title></head><body><button>Sign up free</button><span>$9/month</span><form><input type="email" /><button type="submit">Submit</button></form></body></html>`,
  // Anchor-only soft CTA (v6 fallback).
  `<html><head><title>Learn</title></head><body><a href="/learn">Learn more</a><nav><a href="/about">About</a></nav></body></html>`,
  `<html><head><title>Read</title></head><body><a href="/read">Read the guide</a><nav><a href="/home">Home</a></nav></body></html>`,
  // Pricing-only — CTA absent, price present, no form.
  `<html><head><title>Pricing</title></head><body><span>$99/month</span><p>Contact us for a quote.</p></body></html>`,
  `<html><head><title>Plans</title></head><body><span>₹499</span></body></html>`,
  // Form-only — CTA absent, form present.
  `<html><head><title>Subscribe</title></head><body><form><input type="email" name="email" /><button type="submit">Subscribe</button></form></body></html>`,
  `<html><head><title>Get in touch</title></head><body><form><input type="text" name="name" /><input type="email" name="email" /><button type="submit">Send</button></form></body></html>`,
  // Headline-only — minimal text, no CTA, no price, no form.
  `<html><head><title>About</title></head><body><p>Founded in 2020, we make tools for teams.</p></body></html>`,
  `<html><head><title>Careers</title></head><body><p>Join the team.</p></body></html>`,
  // Anchor-chrome-only — navigation links but no CTA fallback.
  `<html><head><title>Index</title></head><body><nav><a href="/about">About</a><a href="/blog">Blog</a><a href="/contact">Contact</a></nav></body></html>`,
  // Empty shell — capture-validity gate should catch this in the real
  // pipeline. The extractor still runs on it here.
  `<html><body></body></html>`,
  // HTML with only script tags — strips to empty.
  `<html><head><script>var x = 1;</script></head><body></body></html>`,
  // CTA + price + form — full real landing page.
  `<html><head><title>Shop</title></head><body><button>Shop now</button><span>$19</span><form><input type="email" /><button type="submit">Submit</button></form></body></html>`,
  `<html><head><title>Demo</title></head><body><button>Book demo</button><span>Free</span><form><input type="email" /><button type="submit">Submit</button></form></body></html>`,
  `<html><head><title>Trial</title></head><body><button>Start free trial</button><span>$0</span><form><input type="email" /><button type="submit">Submit</button></form></body></html>`,
  // Mixed: priority verb + anchor nav.
  `<html><head><title>Get Offer</title></head><body><button>Get offer</button><nav><a href="/about">About</a></nav></body></html>`,
  // Mixed: priority verb only.
  `<html><head><title>Claim</title></head><body><button>Claim deal</button></body></html>`,
  // Mixed: anchor with priority text.
  `<html><head><title>Order</title></head><body><a href="/order">Order now</a></body></html>`,
  // Mixed: anchor with subscribe text.
  `<html><head><title>Subscribe</title></head><body><a href="/subscribe">Subscribe</a></body></html>`,
  // Just a heading — no CTA, no price, no form.
  `<html><head><title>Hello</title></head><body><h1>Welcome</h1><p>This is our site.</p></body></html>`,
  // Anchor soft CTA — v6 fallback reaches.
  `<html><head><title>Find out</title></head><body><a href="/discover">Discover</a></body></html>`,
  // Anchor soft CTA — another v6 fallback.
  `<html><head><title>Explore</title></head><body><a href="/explore">Explore</a></body></html>`,
  // Just a chrome anchor.
  `<html><head><title>Blog</title></head><body><a href="/blog">Blog</a><p>Read our blog.</p></body></html>`,
];

const DOCUMENTED_STAGES = new Set([
  "html_fetch",
  "html_parse",
  "anchor_resolve",
  "cta_extract",
  "headline_extract",
  "price_extract",
  "form_extract",
  "url_extract",
]);

async function seedWatchlistFixture(
  templateIndex: number,
): Promise<WatchlistFixture> {
  const html = FIXTURE_HTML_TEMPLATES[templateIndex];
  const userId = await seedUser();
  const watchlistId = await seedWatchlist(userId);
  await seedAd();
  await seedProofTarget(watchlistId);
  const runId = await seedRun(watchlistId);
  return {
    watchlistId,
    runId,
    domain: `fixture-${templateIndex.toString().padStart(2, "0")}.example.test`,
    html,
  };
}

describe("landing-page detector integration guard (issue #1500)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let captured: Array<Record<string, unknown>> = [];

  beforeEach(async () => {
    captured = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed.tag === "lp_run_audit") {
          captured.push(parsed);
        }
      } catch {
        // Non-audit lines (other test output) — ignored.
      }
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("emits one audit line per extraction-owned stage for each of 25 watchlists", async () => {
    const fixtures: WatchlistFixture[] = [];
    for (let i = 0; i < FIXTURE_HTML_TEMPLATES.length; i += 1) {
      fixtures.push(await seedWatchlistFixture(i));
    }
    expect(fixtures.length).toBe(25);

    for (const fixture of fixtures) {
      // Reset captured for per-fixture assertions.
      captured.length = 0;
      const signals = extractLandingPageSignals(fixture.html, {
        documentMode: "raw",
        audit: {
          watchlistId: fixture.watchlistId,
          runId: fixture.runId,
          domain: fixture.domain,
        },
      });

      const stagesEmitted = new Set(
        captured.map((row) => String(row.stage)),
      );
      // The extractor owns exactly 5 stages; the capture path owns the
      // other 3. The extractor must emit its 5 — and never accidentally
      // emit any of the capture-owned stages.
      for (const stage of [
        "html_parse",
        "anchor_resolve",
        "cta_extract",
        "price_extract",
        "form_extract",
      ]) {
        expect(stagesEmitted.has(stage)).toBe(true);
      }
      expect(stagesEmitted.has("html_fetch")).toBe(false);
      expect(stagesEmitted.has("headline_extract")).toBe(false);
      expect(stagesEmitted.has("url_extract")).toBe(false);

      // Every audit line must carry the closed enum and the issue-mandated
      // field names so a Workers Logpush filter keeps working.
      for (const row of captured) {
        expect(DOCUMENTED_STAGES.has(String(row.stage))).toBe(true);
        expect(row.tag).toBe("lp_run_audit");
        expect(typeof row.watchlist_id).toBe("string");
        expect(typeof row.run_id).toBe("string");
        expect(typeof row.domain).toBe("string");
        expect(typeof row.outcome).toBe("string");
        expect(typeof row.bytes_in).toBe("number");
        expect(typeof row.bytes_out).toBe("number");
        expect(typeof row.ms).toBe("number");
      }

      // Cross-check: the audit's outcome matches the extractor's
      // real behaviour — `ok` ↔ non-null ctaText, `bailed:<reason>`
      // ↔ null ctaText. This binds the audit to the extractor so the
      // test fails loudly if the two ever drift.
      const ctaAudit = captured.find((row) => row.stage === "cta_extract");
      expect(ctaAudit).toBeDefined();
      if (ctaAudit?.outcome === "ok") {
        expect(signals.ctaText).not.toBeNull();
      } else {
        expect(String(ctaAudit?.outcome ?? "")).toMatch(/^bailed:/);
        expect(signals.ctaText).toBeNull();
      }
    }
  });

  it("≥20 of 25 watchlists reach cta_extract with a non-crash outcome", async () => {
    const fixtures: WatchlistFixture[] = [];
    for (let i = 0; i < FIXTURE_HTML_TEMPLATES.length; i += 1) {
      fixtures.push(await seedWatchlistFixture(i));
    }

    let ctaReached = 0;
    for (const fixture of fixtures) {
      captured.length = 0;
      extractLandingPageSignals(fixture.html, {
        documentMode: "raw",
        audit: {
          watchlistId: fixture.watchlistId,
          runId: fixture.runId,
          domain: fixture.domain,
        },
      });
      const ctaAudit = captured.find((row) => row.stage === "cta_extract");
      expect(ctaAudit).toBeDefined();
      // "reach" here means the extractor ran the stage and emitted a
      // line — the outcome can be ok OR bailed:<reason>, both of which
      // prove the stage did its work and recorded why. A crash would
      // leave the line absent.
      const outcome = String(ctaAudit?.outcome ?? "");
      if (
        outcome === "ok" ||
        (outcome.startsWith("bailed:") && outcome.length > "bailed:".length)
      ) {
        ctaReached += 1;
      }
    }
    expect(ctaReached).toBeGreaterThanOrEqual(20);
  });

  it("≥1 of 25 watchlists produces a real landing_page_cta_changed candidate", async () => {
    const fixtures: WatchlistFixture[] = [];
    for (let i = 0; i < FIXTURE_HTML_TEMPLATES.length; i += 1) {
      fixtures.push(await seedWatchlistFixture(i));
    }

    let ctaOk = 0;
    for (const fixture of fixtures) {
      captured.length = 0;
      const signals = extractLandingPageSignals(fixture.html, {
        documentMode: "raw",
        audit: {
          watchlistId: fixture.watchlistId,
          runId: fixture.runId,
          domain: fixture.domain,
        },
      });
      if (signals.ctaText !== null) ctaOk += 1;
    }
    // The fixture set is built so at least one real landing page with
    // a CTA exists; if this fails the fixture set is broken, not the
    // detector.
    expect(ctaOk).toBeGreaterThanOrEqual(1);
  });
});
