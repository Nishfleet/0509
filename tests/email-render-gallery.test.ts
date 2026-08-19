/**
 * Email render gallery + regression coverage.
 *
 * For most paying Five to Nine customers the emails ARE the product, so every
 * customer-facing template is built here with realistic fixture data, wrapped
 * in the real send-time shell (renderEmailShell), and written to disk so a
 * human can open and judge it. The assertions are deliberately light — the
 * real product of this file is the gallery in EMAIL_GALLERY_DIR — but they
 * pin the load-bearing invariants (non-empty body, unsubscribe presence,
 * forced-light shell) so a future copy/layout edit that breaks a template
 * fails CI instead of shipping silently.
 *
 * Run the suite normally, then open /tmp/email-gallery/index.html.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
  renderAccountActionHtml,
  renderActivationResultHtml,
  renderDeliveryTestHtml,
  renderEmailVerificationHtml,
  renderOperatorAlertHtml,
  renderPasswordResetHtml,
  renderTeamInviteHtml,
  renderWelcomeHtml,
} from "~/lib/delivery-account-emails.server";
import {
  billingCancellationEmailContent,
  billingPaymentIssueEmailContent,
  billingRefundEmailContent,
} from "~/lib/delivery-billing-lifecycle-content.server";
import {
  buildInstantAlertContent,
  renderPresenceDigestHtml,
} from "~/lib/delivery.server";
import {
  buildDigestEmail,
  buildScanTroubleEmail,
  type DigestEmailInput,
} from "~/lib/digest-email.server";
import { renderEmailShell } from "~/lib/email-template.server";
import { buildMonthlyRecapEmail } from "~/lib/monthly-recap.server";
import type { DigestTrustItem } from "~/lib/proof-classification";
import type { WatchEventRecord } from "~/lib/types";

const EMAIL_GALLERY_DIR = "/tmp/email-gallery";

const env = {
  BETTER_AUTH_URL: "https://0509.io",
  APP_ORIGIN: "https://0509.io",
} as unknown as AppEnv;

// Sentinel host used for fixture creatives. The shipped HTML keeps these
// (https, so safeHttpsImageUrl accepts them); the browsable *.view.html copy
// rewrites them to the local ./assets SVGs so a human sees a real thumbnail.
const CDN = "https://assets.0509.local";

type Rendered = { subject: string; html: string };

const gallery: Array<{ id: string; label: string; unsub: boolean; rendered: Rendered }> = [];

function record(
  id: string,
  label: string,
  unsub: boolean,
  subject: string,
  bodyHtml: string,
  unsubscribeUrl: string | null,
) {
  const html = renderEmailShell({ bodyHtml, unsubscribeUrl });
  gallery.push({ id, label, unsub, rendered: { subject, html } });
  return html;
}

// --- fixtures -------------------------------------------------------------

const UNSUB = "https://0509.io/unsubscribe?token=demo";

function digestItem(over: Partial<DigestTrustItem> & { metadata?: Record<string, unknown> }): DigestTrustItem {
  return {
    id: "evt",
    eventId: "evt",
    watchlistId: "wl",
    watchlistName: "Glowkart",
    title: "New ad went live",
    summary: "A new creative entered rotation.",
    proofStatus: "verified_proof",
    createdAt: "2026-07-18T09:12:00.000Z",
    ...over,
    metadata: {
      priorityScore: 88,
      priorityBand: "High priority",
      recommendedAction: "Today: pull the new creative and compare the offer against yours.",
      proofCaptureId: "pc_1",
      status: "confirmed",
      confirmedAt: "2026-07-18T09:12:00.000Z",
      ...(over.metadata ?? {}),
    },
  };
}

const digestItems: DigestTrustItem[] = [
  digestItem({
    watchlistName: "Glowkart",
    title: "Switched the hero offer to 40% off",
    summary:
      "The flagship prospecting ad changed its headline from “20% off your first order” to “40% off everything this weekend”. The discount doubled and the urgency copy is new.",
    metadata: {
      priorityScore: 92,
      priorityBand: "High priority",
      recommendedAction: "Today: match or counter the 40% weekend offer before it out-discounts you.",
      beforeCreativeImageUrl: `${CDN}/creative-before.svg`,
      afterCreativeImageUrl: `${CDN}/creative-after.svg`,
      observedSpend: "₹40,000 – ₹60,000",
      observedImpressions: "500K – 750K",
    },
  }),
  digestItem({
    watchlistName: "Glowkart",
    title: "Launched a serum-focused video ad",
    summary: "A new 15-second video creative for the vitamin-C serum entered rotation across Instagram and Facebook feeds.",
    metadata: {
      priorityScore: 78,
      priorityBand: "Medium priority",
      recommendedAction: "Next review: watch whether the serum push is a test or a sustained line.",
      creativeImageUrl: `${CDN}/creative-single.svg`,
      observedReach: "120K – 180K",
    },
  }),
  digestItem({
    watchlistName: "Tira Beauty",
    title: "Changed the landing page CTA",
    summary: "The lander button moved from “Shop now” to “Get 2 free samples”, shifting from a hard-sell to a sampling hook. No creative attached to this one.",
    proofStatus: undefined,
    metadata: {
      priorityScore: 71,
      priorityBand: "Medium priority",
      recommendedAction: "Next review: sampling offers often precede a bigger launch — keep watching.",
      status: "confirmed",
      proofCaptureId: undefined,
      from: "Shop now",
      to: "Get 2 free samples",
    },
  }),
  digestItem({
    watchlistName: "Tira Beauty",
    title: "Possible new festive campaign",
    summary: "Scheduled monitoring spotted a creative that looks like a Diwali campaign, but it needs a human check before you rely on it.",
    metadata: {
      priorityScore: 66,
      priorityBand: "Medium priority",
      recommendedAction: "Review the source evidence before acting.",
      needsReview: true,
      proofCaptureId: undefined,
    },
  }),
  digestItem({
    watchlistName: "Sugar Cosmetics",
    title: "Retired three older discount ads",
    summary: "Three long-running “flat 30% off” ads dropped out of the active set, which usually signals a creative refresh is coming.",
    metadata: {
      priorityScore: 69,
      priorityBand: "Medium priority",
      recommendedAction: "Next review: expect replacement creatives within a week.",
    },
  }),
];

const baseDigestInput: Omit<DigestEmailInput, "items"> = {
  name: "Priya",
  periodStart: "2026-07-14T00:00:00.000Z",
  periodEnd: "2026-07-20T23:59:59.000Z",
  cadence: "weekly",
  timeZone: "Asia/Kolkata",
  totalEligibleEvents: 9,
  includedEvents: 5,
  omittedEvents: 4,
  strategyParagraph:
    "Glowkart is the one to watch this week — doubling its weekend discount to 40% is an aggressive land-grab, and Tira's sampling CTA suggests a launch is being seeded. Nothing from Sugar beyond a routine creative refresh.",
  fullDigestUrl: "https://0509.io/app/digests/demo",
  manageFrequencyUrl: "https://0509.io/app/notifications",
  supportEmail: "support@0509.io",
  supportMailto: "mailto:support@0509.io",
  unsubscribeUrl: UNSUB,
  upgradeNote: null,
  upgradeUrl: null,
};

function makeEvent(over: Partial<WatchEventRecord> & { metadata?: Record<string, unknown> }): WatchEventRecord {
  return {
    id: "evt1",
    watchlistId: "wl1",
    runId: "run1",
    eventType: "landing_page_offer_changed",
    status: "confirmed",
    importanceScore: 90,
    adId: null,
    baselineFromRunId: null,
    candidateId: null,
    proofCaptureId: "pc_1",
    // Real event titles are generic (see buildEventTitle); the competitor name
    // is added by buildInstantSubject, so titles must NOT repeat it.
    title: "Landing page offer changed",
    summary: "The hero prospecting ad now leads with a 40% weekend discount.",
    confirmedAt: "2026-07-19T06:30:00.000Z",
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: null,
    createdAt: "2026-07-19T06:30:00.000Z",
    ...over,
    metadata: {
      advertiser: "Glowkart",
      from: "20% off your first order",
      to: "40% off everything this weekend",
      beforeCapturedAt: "2026-07-18T06:30:00.000Z",
      capturedAt: "2026-07-19T06:30:00.000Z",
      priorityScore: 90,
      priorityBand: "High priority",
      recommendedAction: "Today: match or counter the 40% weekend offer.",
      ...(over.metadata ?? {}),
    },
  };
}

// --- gallery ---------------------------------------------------------------

describe("email render gallery", () => {
  it("weekly digest — five grouped moves, thumbnails present and absent", () => {
    const model = buildDigestEmail({ ...baseDigestInput, items: digestItems });
    const html = record("digest-weekly", "Weekly digest (5 grouped moves)", true, model.subject, model.html, UNSUB);
    expect(model.subject).toBeTruthy();
    expect(html).toContain("Unsubscribe");
    expect(html).toContain("Glowkart");
    expect(model.text).toContain("Top moves");
  });

  it("daily digest — single high-priority move", () => {
    const model = buildDigestEmail({
      ...baseDigestInput,
      cadence: "daily",
      totalEligibleEvents: 1,
      includedEvents: 1,
      omittedEvents: 0,
      strategyParagraph: null,
      items: [digestItems[0]],
    });
    record("digest-daily", "Daily digest (single move)", true, model.subject, model.html, UNSUB);
    expect(model.html).toContain("40%");
  });

  it("free-plan digest — carries one upgrade line", () => {
    const model = buildDigestEmail({
      ...baseDigestInput,
      upgradeNote: "You're on Free. Paid plans check every 3–6 hours and alert you the moment something changes.",
      upgradeUrl: "https://0509.io/app/billing",
      items: digestItems.slice(0, 3),
    });
    record("digest-free-upgrade", "Weekly digest (free plan, upgrade line)", true, model.subject, model.html, UNSUB);
    expect(model.html).toContain("See plans");
  });

  it("quiet digest — all-quiet heartbeat", () => {
    const model = buildDigestEmail({
      ...baseDigestInput,
      items: [],
      heartbeat: { runs: 42, watchlistsChecked: 6, adsSeen: 214 },
    });
    record("digest-quiet", "Quiet digest (all-quiet heartbeat)", true, model.subject, model.html, UNSUB);
    expect(model.subject.toLowerCase()).toContain("all quiet");
  });

  it("scan-trouble notice", () => {
    const model = buildScanTroubleEmail({
      watchlistNames: ["Glowkart", "Tira Beauty", "Sugar Cosmetics"],
      watchlistsUrl: "https://0509.io/app/watchlists",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: UNSUB,
    });
    record("scan-trouble", "Scan-trouble notice", true, model.subject, model.html, UNSUB);
    expect(model.html).toContain("Open watchlists");
  });

  it("monthly recap", () => {
    const model = buildMonthlyRecapEmail({
      userId: "u1",
      email: "priya@example.com",
      name: "Priya",
      plan: "starter",
      monthKey: "2026-06",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-07-01T00:00:00.000Z",
      changesCaught: 37,
      evidenceCaptured: 88,
      includedAllowance: 120,
      topCompetitorName: "Glowkart",
      topCompetitorChanges: 14,
      billingUrl: "https://0509.io/app/billing",
    });
    record("monthly-recap", "Monthly recap", true, model.subject, model.html, UNSUB);
    expect(model.html).toContain("Glowkart");
  });

  it("welcome", () => {
    const html = renderWelcomeHtml({ name: "Priya", watchlistsUrl: "https://0509.io/app/watchlists" });
    record("welcome", "Welcome", true, "Welcome to Five to Nine — here's what happens next", html, UNSUB);
    expect(html).toContain("Open your competitors");
  });

  it("activation result — three ads found", () => {
    const html = renderActivationResultHtml({
      name: "Priya",
      competitor: "Glowkart",
      count: 12,
      topAds: [
        { headline: "Glow Serum — flat 30% off", body: "Dermat-loved vitamin C serum, now at its lowest price this season.", creativeImageUrl: `${CDN}/ad1.svg` },
        { headline: "Free shipping over ₹499", body: "No code needed — every order over ₹499 ships free this week.", creativeImageUrl: `${CDN}/ad2.svg` },
        { headline: "Diwali combo box", body: null, creativeImageUrl: `${CDN}/ad3.svg` },
      ],
      watchlistUrl: "https://0509.io/app/watchlists?watchlist=wl1",
      billingUrl: "https://0509.io/app/billing",
      proofCaptureSucceeded: true,
    });
    record("activation-3ads", "Activation result (3 ads)", true, "Your activation scan found 12 ads for Glowkart", html, UNSUB);
    expect(html).toContain("Top ads");
    expect(html).toContain("proof-backed brief");
  });

  it("activation result — no live ads", () => {
    const html = renderActivationResultHtml({
      name: null,
      competitor: "Glowkart",
      count: 0,
      topAds: [],
      watchlistUrl: "https://0509.io/app/watchlists?watchlist=wl1",
      billingUrl: "https://0509.io/app/billing",
      proofCaptureSucceeded: false,
    });
    record("activation-none", "Activation result (no ads)", true, "Your activation scan for Glowkart found no live ads", html, UNSUB);
    expect(html).toContain("useful signal");
    expect(html).toContain("no evidence check was used");
  });

  it("instant alert — single change with before/after diff and creative", () => {
    const content = buildInstantAlertContent(
      { id: "wl1", name: "Glowkart" },
      [makeEvent({ adId: "ad-100" })],
      false,
      env,
      new Map([[
        "ad-100",
        { metaAdId: "ad-100", creativeImageUrl: `${CDN}/alert-creative.svg` } as never,
      ]]),
    );
    record("instant-single", "Instant alert (single, diff + creative)", true, content.subject, content.html, UNSUB);
    expect(content.html).toContain("Suggested next action");
    expect(content.html).toContain("40% off everything");
  });

  it("instant alert — batched changes", () => {
    const content = buildInstantAlertContent(
      { id: "wl1", name: "Glowkart" },
      [
        makeEvent({ id: "e1", title: "Doubled the weekend offer to 40% off" }),
        makeEvent({
          id: "e2",
          eventType: "ad_new",
          importanceScore: 74,
          title: "Launched a serum video ad",
          summary: "A new 15-second serum video entered rotation.",
          metadata: { advertiser: "Glowkart", from: "", to: "", priorityScore: 74, priorityBand: "Medium priority", recommendedAction: "Next review: check if the serum push sustains." },
        }),
        makeEvent({
          id: "e3",
          eventType: "landing_page_cta_changed",
          importanceScore: 68,
          title: "Changed the lander CTA to sampling",
          summary: "The landing page button changed to “Get 2 free samples”.",
          metadata: { advertiser: "Glowkart", from: "Shop now", to: "Get 2 free samples", priorityScore: 68, priorityBand: "Medium priority", recommendedAction: "Next review: sampling often precedes a launch." },
        }),
      ],
      false,
      env,
    );
    record("instant-batched", "Instant alert (batched, 3 changes)", true, content.subject, content.html, UNSUB);
    expect(content.subject).toContain("3 changes");
  });

  it("billing — payment issue (dunning)", () => {
    const c = billingPaymentIssueEmailContent(env, { userId: "u1", name: "Priya", occurredAt: "2026-07-19T00:00:00.000Z" });
    record("billing-payment-issue", "Billing — payment issue (dunning)", false, c.subject, c.bodyHtml, null);
    expect(c.bodyHtml).toContain("Update payment method");
  });

  it("billing — cancellation scheduled", () => {
    const c = billingCancellationEmailContent(env, {
      userId: "u1",
      name: "Priya",
      kind: "scheduled",
      effectiveAt: "2026-08-14T00:00:00.000Z",
      eventId: "evt-cancel",
    });
    record("billing-cancel-scheduled", "Billing — cancellation scheduled", false, c.subject, c.bodyHtml, null);
    expect(c.bodyHtml).toContain("stays active until");
  });

  it("billing — access ended", () => {
    const c = billingCancellationEmailContent(env, {
      userId: "u1",
      name: "Priya",
      kind: "ended",
      eventId: "evt-ended",
    });
    record("billing-access-ended", "Billing — access ended", false, c.subject, c.bodyHtml, null);
    expect(c.bodyHtml).toContain("Free plan");
  });

  it("billing — refund", () => {
    const c = billingRefundEmailContent(env, { userId: "u1", name: "Priya", eventId: "evt-refund" });
    record("billing-refund", "Billing — refund", false, c.subject, c.bodyHtml, null);
    expect(c.bodyHtml).toContain("refund");
  });

  it("password reset", () => {
    const html = renderPasswordResetHtml({ name: "Priya", resetUrl: "https://0509.io/reset?token=demo" });
    record("password-reset", "Password reset", false, "Reset your Five to Nine password", html, null);
    expect(html).toContain("Reset password");
  });

  it("email verification", () => {
    const html = renderEmailVerificationHtml({ name: "Priya", verifyUrl: "https://0509.io/verify?token=demo" });
    record("email-verification", "Email verification", false, "Verify your email for Five to Nine", html, null);
    expect(html).toContain("Verify email");
  });

  it("account — change email", () => {
    const html = renderAccountActionHtml({ name: "Priya", kind: "change_email", actionUrl: "https://0509.io/confirm?token=demo" });
    record("account-change-email", "Account — change email", false, "Confirm your new email for Five to Nine", html, null);
    expect(html).toContain("Confirm email change");
  });

  it("account — delete", () => {
    const html = renderAccountActionHtml({ name: "Priya", kind: "delete_account", actionUrl: "https://0509.io/confirm?token=demo" });
    record("account-delete", "Account — delete", false, "Confirm account deletion — Five to Nine", html, null);
    expect(html).toContain("Delete my account");
  });

  it("team invite", () => {
    const html = renderTeamInviteHtml({ ownerName: "Priya Sharma", acceptUrl: "https://0509.io/invite?token=demo" });
    record("team-invite", "Team invite", false, "Priya Sharma invited you to Five to Nine", html, null);
    expect(html).toContain("Join the workspace");
  });

  it("delivery test", () => {
    const html = renderDeliveryTestHtml({ name: "Priya" });
    record("delivery-test", "Delivery test", false, "Test email from Five to Nine", html, null);
    expect(html).toContain("test from Five to Nine");
  });

  it("operator alert (internal)", () => {
    const html = renderOperatorAlertHtml({
      lines: [
        "Glowkart watchlist: 3 scans failed in a row (browser render timeout).",
        "priya@example.com: 2 digest emails bounced this week.",
      ],
    });
    record("operator-alert", "Operator alert (internal)", false, "Customer-at-risk signals — Five to Nine", html, null);
    expect(html).toContain("0509.io/ops");
  });

  it("presence digest", () => {
    const html = renderPresenceDigestHtml({
      lines: [
        "Glowkart appeared on 3 new placements: a homepage takeover on a beauty blog and two newsletter sponsorships.",
        "Tira Beauty ran a podcast read on a top lifestyle show.",
      ],
      appUrl: "https://0509.io/app/presence",
    });
    record("presence-digest", "Presence digest", true, "Where your competitors showed up this week", html, UNSUB);
    expect(html).toContain("Open presence tracking");
  });

  it("writes the browsable gallery", () => {
    if (existsSync(EMAIL_GALLERY_DIR)) {
      for (const entry of gallery) {
        rmSync(join(EMAIL_GALLERY_DIR, `${entry.id}.html`), { force: true });
        rmSync(join(EMAIL_GALLERY_DIR, `${entry.id}.view.html`), { force: true });
      }
    }
    mkdirSync(EMAIL_GALLERY_DIR, { recursive: true });

    const pageWrap = (title: string, inner: string) =>
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{margin:0;background:#eef1f6;}</style></head><body>${inner}</body></html>`;

    for (const entry of gallery) {
      // Shipped HTML (keeps https sentinel creatives).
      writeFileSync(join(EMAIL_GALLERY_DIR, `${entry.id}.html`), pageWrap(entry.rendered.subject, entry.rendered.html));
      // Browsable copy: point sentinel creatives at the local SVGs.
      const view = entry.rendered.html.split(CDN).join("./assets");
      writeFileSync(join(EMAIL_GALLERY_DIR, `${entry.id}.view.html`), pageWrap(entry.rendered.subject, view));
    }

    const index = gallery
      .map(
        (entry) =>
          `<article style="margin:0 0 40px;"><h2 style="font:600 15px Inter,Arial;margin:0 0 4px;">${entry.label}${entry.unsub ? "" : " · transactional"}</h2><p style="font:400 13px Inter,Arial;color:#667;margin:0 0 10px;">Subject: ${entry.rendered.subject}</p><iframe src="./${entry.id}.view.html" style="width:100%;max-width:640px;height:760px;border:1px solid #d7dce5;border-radius:12px;background:#fff;"></iframe></article>`,
      )
      .join("\n");
    writeFileSync(
      join(EMAIL_GALLERY_DIR, "index.html"),
      pageWrap(
        "Five to Nine — email gallery",
        `<div style="max-width:700px;margin:0 auto;padding:32px 16px;"><h1 style="font:600 22px Inter,Arial;">Five to Nine — email gallery</h1><p style="font:400 14px Inter,Arial;color:#667;">${gallery.length} templates.</p>${index}</div>`,
      ),
    );

    expect(gallery.length).toBeGreaterThanOrEqual(20);
  });
});
