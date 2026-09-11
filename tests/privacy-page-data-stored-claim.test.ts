import { createElement } from "react";
import { mockReactRouter } from "./helpers/mock-react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PrivacyRoute is purely static (no loader data), but it renders <Link> from
// react-router and may call loader hooks; mock react-router with a working
// <Link> and inert loader stubs so the route renders server-side.
beforeEach(() => {
  vi.resetModules();
  mockReactRouter({
    loader: () => undefined,
    loaderData: () => undefined,
  });
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function renderPrivacyPage(): Promise<string> {
  const { default: PrivacyRoute } = await import("~/routes/privacy");
  return renderToStaticMarkup(createElement(PrivacyRoute));
}

const EXISTING_DISCLOSURE_SENTENCES = [
  "This is a plain-English summary of the current product behavior.",
  "We collect account details, saved searches, watchlists, collections, notes, reports, share links, delivery targets, customer-provided Meta access settings, and operational logs needed to run the account.",
  "The product may store ad records, extracted text, screenshots, HTML, timestamps, source URLs, and delivery attempts so teams can verify what changed.",
  "Tracking status stays visible when results are recent, delayed, or freshly verified.",
  "Email delivery is handled by Five to Nine&#x27;s email provider.",
  "Public pages include a Site Rep assistant.",
  "We do not claim SOC 2, HIPAA, GDPR compliance, zero retention, no training, or similar guarantees until the matching policy, vendor configuration, and product behavior are verified.",
];

describe("/privacy — Evidence data claim (issue #1778, BET 10 / privacy surface)", () => {
  it("does NOT list 'landing-page snapshots' as stored data", async () => {
    const markup = await renderPrivacyPage();

    // The "Evidence data" block must no longer make the false stored-data claim.
    expect(markup).not.toContain("landing-page snapshots");
    // Positive anchor: the block itself must render, so the negative assertion
    // above cannot pass vacuously if the "Evidence data" section silently
    // disappears. (mirrors the #1498 trust lock test)
    expect(markup).toContain("so teams can verify what changed");
  });
});

describe("/privacy — Funnel measurement section (issue #2105, spec §8 gate 5)", () => {
  it("describes anonymous event-name measurement, no cookies/IP/email, GPC, and logs-only retention", async () => {
    const markup = await renderPrivacyPage();

    expect(markup).toContain("<h2>Funnel measurement</h2>");
    expect(markup).toContain("anonymous event names only");
    expect(markup).toContain("does not use cookies, IP addresses, or email");
    expect(markup).toContain("Global Privacy Control");
    expect(markup).toContain("operational logs only");
    expect(markup).not.toMatch(/processor|subprocessor|retention window|DPA|consent/i);
  });

  it("keeps every existing disclosure sentence unchanged", async () => {
    const markup = await renderPrivacyPage();

    for (const sentence of EXISTING_DISCLOSURE_SENTENCES) {
      expect(markup).toContain(sentence);
    }
  });
});
