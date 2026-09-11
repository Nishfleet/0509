import { describe, expect, it } from "vitest";

import {
  assessCaptureValidity,
  classifyCaptureValidity,
} from "~/lib/capture-validity.server";
import type { LandingPageSnapshotData, ProofCaptureRecord } from "~/lib/types";

// A real landing page with enough visible body copy to clear the gate. Used as
// the positive control for every adversarial fixture: the same suite that
// rejects the failure shapes must still accept a genuine page.
const REAL_LANDING_PAGE = `<html><head>
  <title>Glow Serum — Save 20% Today</title>
  <meta property="og:title" content="Glow Serum — Save 20% Today"/>
</head><body>
  <header><nav>Shop About Reviews Contact</nav></header>
  <main>
    <h1>Glow Serum — Save 20% Today</h1>
    <p>Our best-selling vitamin C serum, now at 20% off for the launch week.</p>
    <p>Starting at ₹499. Free shipping on orders over ₹999.</p>
    <a href="/buy" class="cta">Buy now</a>
    <form action="/checkout" method="post">
      <input name="email" type="email" placeholder="Email"/>
      <button type="submit">Get offer</button>
    </form>
  </main>
  <footer>© 2026 Glow Co. All rights reserved. Terms · Privacy · Support</footer>
</body></html>`;

function realPage(overrides: { fetchStatus?: number } = {}) {
  return {
    html: REAL_LANDING_PAGE,
    fetchStatus: overrides.fetchStatus ?? 200,
    documentMode: "raw" as const,
  };
}

describe("assessCaptureValidity — genuine page", () => {
  it("accepts a real landing page with full body copy", () => {
    const result = assessCaptureValidity(realPage());
    expect(result.valid).toBe(true);
    expect(result.reasonCode).toBeNull();
  });

  it("accepts a real landing page in rendered document mode", () => {
    const result = assessCaptureValidity({ ...realPage(), documentMode: "rendered" });
    expect(result.valid).toBe(true);
  });
});

describe("assessCaptureValidity — HTTP status class", () => {
  it("rejects a 500 with landing_error_page", () => {
    const result = assessCaptureValidity({
      html: REAL_LANDING_PAGE,
      fetchStatus: 500,
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("landing_error_page");
    expect(result.fingerprint).toBe("http_500");
  });

  it("rejects a 403 with landing_error_page", () => {
    const result = assessCaptureValidity({
      html: REAL_LANDING_PAGE,
      fetchStatus: 403,
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("landing_error_page");
  });
});

describe("assessCaptureValidity — Cloudflare / anti-bot challenge", () => {
  it("rejects a Cloudflare 'Just a moment' interstitial", () => {
    const html = `<html><head><title>Just a moment...</title></head>
      <body><div id="cf-challenge-running">Verifying you are human. This may take a few seconds.</div>
      <script src="/cdn-cgi/challenge-platform/h/g/orchestrate/jsch/v1"></script></body></html>`;
    const result = assessCaptureValidity({ html, fetchStatus: 200 });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("landing_challenge_page");
  });

  it("rejects a Cloudflare Turnstile container", () => {
    const html = `<html><body>
      <div class="cf-turnstile-container" data-sitekey="0xabc"></div>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
    </body></html>`;
    const result = assessCaptureValidity({ html, fetchStatus: 200 });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("landing_challenge_page");
  });

  it("rejects a 'Checking your browser' PerimeterX interstitial", () => {
    const html = `<html><head><title>Checking your browser before accessing the site</title></head>
      <body><div id="px-captcha"></div><script>window._pxAppId="123";</script></body></html>`;
    const result = assessCaptureValidity({ html, fetchStatus: 200 });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("landing_challenge_page");
  });
});

describe("assessCaptureValidity — cookie / consent wall", () => {
  it("rejects an OneTrust banner with gating copy and a thin body", () => {
    const html = `<html><body>
      <div id="onetrust-banner-sdk">
        <p>We use cookies to improve your browsing experience.</p>
        <button id="onetrust-accept-all-handler">Accept all cookies</button>
      </div>
    </body></html>`;
    const result = assessCaptureValidity({ html, fetchStatus: 200 });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("landing_cookie_wall");
  });

  it("rejects a Cookiebot banner with explicit gating copy", () => {
    const html = `<html><body>
      <div id="cookiebot-banner">
        <p>Please accept cookies to continue.</p>
      </div>
      <main>Some real product copy that is long enough to clear the body threshold on its own, so the gating copy path is what trips the gate rather than the thin-body path.</main>
    </body></html>`;
    const result = assessCaptureValidity({ html, fetchStatus: 200 });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("landing_cookie_wall");
  });

  it("does NOT reject a non-gating cookie notice on top of a full page", () => {
    // A cookie banner that does not gate the real content (no gating copy, full
    // body underneath) is not a render failure. The gate must not trip here.
    const html = `<html><body>
      <div id="onetrust-banner-sdk"><p>We use cookies. <a href="#">Manage</a></p></div>
      <main>
        <h1>Glow Serum — Save 20% Today</h1>
        <p>Our best-selling vitamin C serum, now at 20% off for the launch week.</p>
        <p>Starting at ₹499. Free shipping on orders over ₹999.</p>
        <a href="/buy" class="cta">Buy now</a>
      </main>
      <footer>© 2026 Glow Co. All rights reserved. Terms · Privacy · Support</footer>
    </body></html>`;
    const result = assessCaptureValidity({ html, fetchStatus: 200 });
    expect(result.valid).toBe(true);
  });
});

describe("assessCaptureValidity — partial SPA shell", () => {
  it("rejects an empty React root with no meaningful body", () => {
    const html = `<html><body><div id="root"></div></body></html>`;
    const result = assessCaptureValidity({ html, fetchStatus: 200 });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("landing_partial_spa");
  });

  it("rejects a 'please enable JavaScript' noscript shell", () => {
    const html = `<html><body>
      <noscript>You need to enable JavaScript to run this app.</noscript>
      <div id="root"></div>
    </body></html>`;
    const result = assessCaptureValidity({ html, fetchStatus: 200 });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("landing_partial_spa");
  });

  it("does NOT reject a hydrated SPA that ships real SSR copy inside the root", () => {
    // An empty `<div id="root">` is only a partial-SPA failure when the body
    // never hydrated. Real SSR copy inside the root is a real page.
    const html = `<html><body>
      <div id="root">
        <main>
          <h1>Glow Serum — Save 20% Today</h1>
          <p>Our best-selling vitamin C serum, now at 20% off for the launch week.</p>
          <p>Starting at ₹499. Free shipping on orders over ₹999.</p>
          <a href="/buy" class="cta">Buy now</a>
        </main>
      </div>
    </body></html>`;
    const result = assessCaptureValidity({ html, fetchStatus: 200 });
    expect(result.valid).toBe(true);
  });
});

describe("assessCaptureValidity — generic error page (200 with error copy)", () => {
  it("rejects a thin '404 not found' body", () => {
    const html = `<html><body><main><h1>404</h1><p>This page could not be found.</p></main></body></html>`;
    const result = assessCaptureValidity({ html, fetchStatus: 200 });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("landing_error_page");
  });

  it("rejects a 'site under maintenance' banner", () => {
    const html = `<html><body><main><h1>We'll be back shortly</h1><p>Site is under maintenance.</p></main></body></html>`;
    const result = assessCaptureValidity({ html, fetchStatus: 200 });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("landing_error_page");
  });

  it("does NOT reject a full page that mentions an error state in copy", () => {
    // A real page that happens to mention "404 not found" in its copy (e.g. a
    // helpful homepage) must not trip. The thinness guard distinguishes the two.
    const html = `<html><body>
      <main>
        <h1>Glow Serum — Save 20% Today</h1>
        <p>Our best-selling vitamin C serum, now at 20% off for the launch week.</p>
        <p>Got a 404 not found error? Here's our homepage with all current offers.</p>
        <p>Starting at ₹499. Free shipping on orders over ₹999.</p>
        <a href="/buy" class="cta">Buy now</a>
      </main>
      <footer>© 2026 Glow Co. All rights reserved. Terms · Privacy · Support</footer>
    </body></html>`;
    const result = assessCaptureValidity({ html, fetchStatus: 200 });
    expect(result.valid).toBe(true);
  });
});

describe("assessCaptureValidity — content signature too small", () => {
  it("rejects a near-empty body that is not a recognized failure shape", () => {
    const html = `<html><body><main>Loading…</main></body></html>`;
    const result = assessCaptureValidity({ html, fetchStatus: 200 });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("landing_content_signature_too_small");
  });
});

describe("assessCaptureValidity — site-down-then-restored", () => {
  it("rejects the down capture (maintenance) and accepts the restored page", () => {
    const down = `<html><body><main><h1>We'll be back shortly</h1><p>Site is under maintenance.</p></main></body></html>`;
    expect(assessCaptureValidity({ html: down, fetchStatus: 200 }).valid).toBe(false);

    const restored = REAL_LANDING_PAGE;
    expect(assessCaptureValidity({ html: restored, fetchStatus: 200 }).valid).toBe(true);
  });
});

function proofSnapshot(overrides: Partial<LandingPageSnapshotData> = {}): LandingPageSnapshotData {
  return {
    rawUrl: "https://example.com/offer",
    canonicalUrl: "https://example.com/offer",
    rawHeadline: "Glow Serum Sale",
    normalizedHeadline: "glow serum sale",
    normalizedHeadlineHash: "hash-a",
    ctaText: "Buy now",
    priceText: "Starting at ₹499",
    formPresent: true,
    captureMethod: "landing_page_fetch",
    capturedAt: "2026-08-25T13:00:00.000Z",
    metadata: { captureValidated: true, screenshotCorroborates: true },
    ...overrides,
  };
}

function baselineProofRecord(
  overrides: Partial<ProofCaptureRecord["extractedFields"]> = {},
): ProofCaptureRecord {
  return {
    id: "proof-baseline",
    proofTargetId: "target-1",
    status: "succeeded",
    skipReason: null,
    failureCode: null,
    failureReason: null,
    screenshotArtifactKey: "landing-pages/shot.jpeg",
    htmlArtifactKey: "landing-pages/page.html",
    extractedFields: {
      rawHeadline: "Glow Serum Sale",
      normalizedHeadline: "glow serum sale",
      normalizedHeadlineHash: "hash-a",
      ctaText: "Buy now",
      priceText: "Starting at ₹499",
      formPresent: true,
      ...overrides,
    },
    fieldConfidence: {},
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "lp-signals-v1",
    idempotencyKey: "proof-request:watch-1",
    attemptedAt: "2026-08-25T10:00:00.000Z",
    succeededAt: "2026-08-25T10:00:01.000Z",
    createdAt: "2026-08-25T10:00:01.000Z",
    updatedAt: "2026-08-25T10:00:01.000Z",
  };
}

const PROOF_TARGET_IDENTITY = "watch-1:meta-boat-1:example.com/glow";

describe("classifyCaptureValidity — tri-state classifier (issue #1399)", () => {
  it("classifies a capture_failed from a null snapshot and failure detail", () => {
    const classification = classifyCaptureValidity({
      snapshot: null,
      failureDetail: { reasonCode: "landing_challenge_page" },
    });

    expect(classification.status).toBe("capture_failed");
    expect(classification.reason).toBe("landing_challenge_page");
    expect(classification.events).toHaveLength(0);
    expect(classification.evaluation).toBeNull();
  });

  it("classifies a suppressed capture during a scheduled maintenance window", () => {
    // The page is valid, but the capture is inside a scheduled maintenance
    // window — the scheduled maintenance window reason.
    const classification = classifyCaptureValidity({
      snapshot: proofSnapshot(),
      failureDetail: null,
      maintenanceWindow: true,
    });

    expect(classification.status).toBe("suppressed");
    expect(classification.reason).toBe("maintenance_window");
    expect(classification.events).toHaveLength(0);
    expect(classification.evaluation?.status).toBe("suppressed");
  });

  it("classifies a genuine price edit as succeeded", () => {
    const baseline = baselineProofRecord();
    const snapshot = proofSnapshot({
      priceText: "Starting at ₹399",
    });

    const classification = classifyCaptureValidity({
      snapshot,
      failureDetail: null,
      currentProof: {
        rawHeadline: snapshot.rawHeadline,
        normalizedHeadline: snapshot.normalizedHeadline,
        normalizedHeadlineHash: snapshot.normalizedHeadlineHash,
        ctaText: snapshot.ctaText ?? null,
        priceText: snapshot.priceText ?? null,
        formPresent: snapshot.formPresent ?? null,
        extractorVersion: "lp-signals-v1",
      },
      lastSuccessfulProof: baseline,
      recentWatchEvents: [],
      proofTargetIdentity: PROOF_TARGET_IDENTITY,
      sensitivityMode: "balanced",
      burstCount: 1,
      currentCapturedAt: snapshot.capturedAt,
      screenshotCorroborates: true,
    });

    expect(classification.status).toBe("succeeded");
    expect(classification.reason).toBeNull();
    expect(classification.events).toHaveLength(1);
    expect(classification.events[0]?.eventType).toBe("landing_page_offer_changed");
    expect(classification.events[0]?.status).toBe("confirmed");
  });

  it("classifies an unconfirmed price change as suppressed", () => {
    const baseline = baselineProofRecord();
    const snapshot = proofSnapshot({
      priceText: "Starting at ₹399",
      metadata: { captureValidated: true, screenshotCorroborates: false },
    });

    const classification = classifyCaptureValidity({
      snapshot,
      failureDetail: null,
      currentProof: {
        rawHeadline: snapshot.rawHeadline,
        normalizedHeadline: snapshot.normalizedHeadline,
        normalizedHeadlineHash: snapshot.normalizedHeadlineHash,
        ctaText: snapshot.ctaText ?? null,
        priceText: snapshot.priceText ?? null,
        formPresent: snapshot.formPresent ?? null,
        extractorVersion: "lp-signals-v1",
      },
      lastSuccessfulProof: baseline,
      recentWatchEvents: [],
      proofTargetIdentity: PROOF_TARGET_IDENTITY,
      sensitivityMode: "balanced",
      burstCount: 1,
      currentCapturedAt: snapshot.capturedAt,
      screenshotCorroborates: false,
    });

    expect(classification.status).toBe("suppressed");
    expect(classification.reason).toBe("unconfirmed_by_screenshot");
    expect(classification.events).toHaveLength(1);
    expect(classification.events[0]?.status).toBe("suppressed");
  });
});
