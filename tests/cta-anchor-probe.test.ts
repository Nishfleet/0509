import { describe, expect, it } from "vitest";
import { extractLandingPageSignals } from "~/lib/landing-page-signals.server";

// Issue #1401: the CTA detector was silent for 75 days because pages whose
// only CTA is a generic anchor (no priority verb, no <button>) bailed to
// null. These tests pin the v6 anchor-text fallback that flips that bail into
// a reached extraction, and the funnel reason codes that make the bail-out
// diagnosable.
describe("CTA anchor fallback (v6, issue #1401)", () => {
  it("extracts a soft-CTA anchor when no priority verb and no button match", () => {
    const html = '<a href="/learn">Learn more</a>';
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Learn more");
    expect(ctaFunnel).toEqual({ stage: "reached", reasonCode: null });
  });

  it("extracts a commercial anchor without a priority verb", () => {
    const html = '<a href="/report">Build my report</a>';
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Build my report");
    expect(ctaFunnel.stage).toBe("reached");
  });

  it("skips navigation-chrome anchors and bails with only_chrome_anchors", () => {
    const html = `
      <nav>
        <a href="/about">About</a>
        <a href="/blog">Blog</a>
        <a href="/login">Login</a>
      </nav>
    `;
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({ stage: "bailed", reasonCode: "only_chrome_anchors" });
  });

  it("picks the first non-chrome anchor when nav and a soft CTA coexist", () => {
    const html = `
      <nav><a href="/about">About</a><a href="/login">Login</a></nav>
      <main><a href="/guide">Read the guide</a></main>
    `;
    const { ctaText } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Read the guide");
  });

  it("bails with no_cta_candidates when there are no buttons, submits, or anchors", () => {
    const html = "<main><p>Just plain words here.</p></main>";
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({ stage: "bailed", reasonCode: "no_cta_candidates" });
  });

  it("bails with empty_capture when the visible body is blank", () => {
    const html = "<html><head></head><body><script>x()</script></body></html>";
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({ stage: "bailed", reasonCode: "empty_capture" });
  });

  it("bails with only_chrome_buttons when every button is UI chrome", () => {
    const html = "<button>Menu</button><button>Close</button>";
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({ stage: "bailed", reasonCode: "only_chrome_buttons" });
  });

  it("still prefers a priority-verb button over an anchor fallback", () => {
    const html = `
      <a href="/learn">Learn more</a>
      <button>Buy now</button>
    `;
    const { ctaText } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Buy now");
  });

  it("still prefers a non-chrome button over the anchor fallback", () => {
    const html = `
      <a href="/learn">Learn more</a>
      <button>Build my report</button>
    `;
    const { ctaText } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Build my report");
  });

  it("skips search-command and calendar chrome buttons in the fallback", () => {
    const html = `
      <button>Search… Ctrl K</button>
      <button>12</button>
      <button>UTC Time (12:01am)</button>
      <button>Show more</button>
    `;
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({
      stage: "bailed",
      reasonCode: "only_chrome_buttons",
    });
  });

  it("skips Calendly cookie chrome and reaches a soft-CTA anchor instead", () => {
    const html = `
      <button>Show more</button>
      <button>Accept all</button>
      <button>Cookie settings</button>
      <a href="/book">Book a slot</a>
    `;
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Book a slot");
    expect(ctaFunnel.stage).toBe("reached");
  });

  it("skips login-wall and cookie-detail chrome including bidi marks", () => {
    const html = `
      <button>Try again</button>
      <a href="/forgot">Forgotten password?</a>
      <button>Cookie Details\u200e</button>
    `;
    const { ctaText, ctaFunnel } = extractLandingPageSignals(html);
    expect(ctaText).toBeNull();
    expect(ctaFunnel).toEqual({
      stage: "bailed",
      reasonCode: "only_chrome_buttons",
    });
  });
});
