import { describe, expect, it } from "vitest";

import { createLandingPageSnapshot } from "~/lib/data/ads.server";
import { createWatchEvent } from "~/lib/data/watch-events.server";
import {
  diffOfferFromAgent,
  getChangeHistoryFromAgent,
  getOfferStateAtFromAgent,
  listSuppressedFromAgent,
} from "~/lib/customer-agent-actions/change-history.server";

import { appEnv, db, seedProofCapture, seedProofTarget, seedWatchlistWithRun } from "./fixtures";

const DOMAIN = "ch1108.com";

function hexKey(day: string, hex: string, ext: "html" | "jpeg") {
  return `landing-pages/${day}/${hex}.${ext}`;
}

async function seedSnapshot(input: {
  canonicalUrl: string;
  headline: string;
  ctaText: string;
  priceText: string;
  capturedAt: string;
  htmlKey: string;
  screenshotKey: string;
}) {
  return createLandingPageSnapshot(appEnv, {
    rawUrl: input.canonicalUrl,
    canonicalUrl: input.canonicalUrl,
    rawHeadline: input.headline,
    normalizedHeadline: input.headline.toLowerCase(),
    normalizedHeadlineHash: `hash_${input.headline}`,
    captureMethod: "landing_page_fetch",
    artifactKey: input.htmlKey,
    metadata: { screenshotArtifactKey: input.screenshotKey, htmlArtifactKey: input.htmlKey },
    ctaText: input.ctaText,
    priceText: input.priceText,
    formPresent: false,
    capturedAt: input.capturedAt,
  });
}

describe("change-history tools against real D1", () => {
  it("reads seeded offer states and suppressed events with evidence links", async () => {
    const day1 = "2026-06-01";
    const day2 = "2026-06-15";
    const html1 = hexKey(day1, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "html");
    const html2 = hexKey(day2, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "html");
    const shot1 = hexKey(day1, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "jpeg");
    const shot2 = hexKey(day2, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "jpeg");

    await seedSnapshot({
      canonicalUrl: `https://${DOMAIN}/offer`,
      headline: "20% off first order",
      ctaText: "Shop now",
      priceText: "20% off",
      capturedAt: `${day1}T10:00:00.000Z`,
      htmlKey: html1,
      screenshotKey: shot1,
    });
    await seedSnapshot({
      canonicalUrl: `https://www.${DOMAIN}/offer`,
      headline: "30% off first order",
      ctaText: "Get 30% off",
      priceText: "30% off",
      capturedAt: `${day2}T10:00:00.000Z`,
      htmlKey: html2,
      screenshotKey: shot2,
    });

    const { userId, watchlistId, runId } = await seedWatchlistWithRun();
    await db()
      .prepare("UPDATE watchlist SET target_id = ? WHERE id = ?")
      .bind(`https://${DOMAIN}`, watchlistId)
      .run();
    const proofTargetId = await seedProofTarget(watchlistId);
    await db()
      .prepare("UPDATE proof_target SET landing_page_url = ? WHERE id = ?")
      .bind(`https://${DOMAIN}/offer`, proofTargetId)
      .run();
    const proofCaptureId = await seedProofCapture(proofTargetId, "{}");
    await db()
      .prepare(
        "UPDATE proof_capture SET screenshot_artifact_key = ?, html_artifact_key = ? WHERE id = ?",
      )
      .bind(shot2, html2, proofCaptureId)
      .run();
    await createWatchEvent(appEnv, {
      watchlistId,
      runId,
      eventType: "landing_page_headline_changed",
      adId: null,
      baselineFromRunId: null,
      title: "Headline churn",
      summary: "Repeated headline swap.",
      metadata: { landingPageUrl: `https://${DOMAIN}/offer` },
      status: "suppressed",
      proofCaptureId,
      suppressedAt: "2026-06-20T12:01:00.000Z",
    });

    const history = await getChangeHistoryFromAgent(
      appEnv,
      userId,
      { domain: DOMAIN, since: "2026-06-01" },
      "https://0509.io",
    );
    expect(history.offerChanges).toHaveLength(1);
    expect(history.offerChanges[0]?.headline).toBe("30% off first order");
    expect(history.offerChanges[0]?.evidenceLink).toContain("https://0509.io/artifacts/proof/");
    expect(history.offerChanges[0]?.capturedAt).toBe("2026-06-15T10:00:00.000Z");

    const state = await getOfferStateAtFromAgent(
      appEnv,
      { domain: DOMAIN, date: "2026-06-20" },
      "https://0509.io",
    );
    expect(state.state?.headline).toBe("30% off first order");
    expect(state.state?.evidenceLink).toContain("https://0509.io/artifacts/proof/");

    const diff = await diffOfferFromAgent(
      appEnv,
      { domain: DOMAIN, dateA: "2026-06-01", dateB: "2026-06-20" },
      null,
    );
    expect(diff.diff?.headline).toEqual({
      before: "20% off first order",
      after: "30% off first order",
    });

    const suppressed = await listSuppressedFromAgent(appEnv, userId, { domain: DOMAIN }, null);
    expect(suppressed.events).toHaveLength(1);
    expect(suppressed.events[0]?.suppressedAt).toBe("2026-06-20T12:01:00.000Z");
    expect(suppressed.events[0]?.evidenceLink?.startsWith("/artifacts/proof/")).toBe(true);
    expect(suppressed.events[0]?.capturedAt).toBeTruthy();
  });
});
