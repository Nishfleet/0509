import { describe, expect, it } from "vitest";

import { assessCaptureValidity } from "~/lib/capture-validity.server";

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
