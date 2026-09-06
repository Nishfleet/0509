import type { Locator, Page, TestInfo } from "@playwright/test";

export const RELEASE_ARTIFACT_STATES = {
  j1: [
    "docs",
    "status",
    "help",
    "trust",
    "privacy",
    "terms",
    "home",
    "invalid",
    "empty",
    "degraded",
    "proof",
    "timeline",
    "signup",
  ],
  "j2-proof": ["onboard", "invalid", "empty", "degraded", "proof"],
  "j2-activation": ["onboard", "activation-paused"],
  "j2-first-run-beat-1": ["first-run-empty-free"],
  "j3-monitoring": ["monitoring"],
  "j3-digest": ["digest-notifications"],
  "j3-gated": ["empty-gated-recovery"],
  "j3-preseeded": ["empty-recovered"],
  "j3-privacy": ["owner-member-privacy"],
  "j3-first-run-wait": ["first-run-wait"],
  "j3-first-brief": ["first-brief-front-page"],
  "j4-report": ["report-proof"],
  "j4-export": ["export-share-gate"],
  "j4-clients": ["empty-gated-room"],
  "j4-share": ["share-revoke-rereview"],
  "j4-room": ["approval-recovery"],
  "j4-missing": ["missing-recovery"],
  "j5-plan": ["plan-boundary-entitlement"],
  "j5-lifecycle": ["payment-recovered", "cancelled", "refunded"],
  "j6-return": ["dashboard-account"],
  "j6-account": ["account-validation-recovery"],
  "j6-support": ["support-failure-recovery"],
  "j6-retention": ["retention-restore-integrity"],
  "j6-auth": ["auth-outage-recovery"],
  "j6-team": ["invite-concurrency-recovery"],
} as const;

export type ReleaseArtifactPrefix = keyof typeof RELEASE_ARTIFACT_STATES;
export type ReleaseArtifactState = (typeof RELEASE_ARTIFACT_STATES)[ReleaseArtifactPrefix][number];

function viewportToken(page: Page): string {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("release_artifact_viewport_missing");
  return `${viewport.width}x${viewport.height}`;
}

function assertState(prefix: ReleaseArtifactPrefix, state: ReleaseArtifactState): void {
  const allowedStates = RELEASE_ARTIFACT_STATES[prefix] as readonly string[];
  if (!allowedStates.includes(state)) throw new Error("release_artifact_state_invalid");
}

export function releaseArtifactName(
  prefix: ReleaseArtifactPrefix,
  viewport: string,
  state: ReleaseArtifactState,
  kind: "screenshot" | "aria",
): string {
  assertState(prefix, state);
  if (!/^\d{3,4}x\d{3,4}$/u.test(viewport)) throw new Error("release_artifact_viewport_invalid");
  return `${prefix}-${viewport}-${state}.${kind === "screenshot" ? "png" : "aria.json"}`;
}

export async function attachReleaseStateArtifacts({
  page,
  testInfo,
  prefix,
  state,
  ariaRoot = page.locator("body"),
}: {
  page: Page;
  testInfo: TestInfo;
  prefix: ReleaseArtifactPrefix;
  state: ReleaseArtifactState;
  ariaRoot?: Locator;
}): Promise<void> {
  const viewport = viewportToken(page);
  // Hard navigations and horizontal-nav auto-reveal can leave Chromium's
  // compositor one frame behind the asserted DOM. Wait on semantic browser
  // readiness and two paints rather than a fixed delay so the release image
  // proves the state a customer actually sees.
  // BOUNDED: on CI's mobile-safari engine with a desktop viewport,
  // document.fonts.ready (and, throttled, rAF) can simply never settle —
  // this exact wait ate the full 30s test budget three retries in a row and
  // blocked a production deploy. The artifact is evidence, not a correctness
  // gate: prefer a slightly-early screenshot over a dead release train.
  await page.evaluate(async () => {
    const bounded = <T,>(work: Promise<T>, ms: number) =>
      Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, ms))]);
    await bounded(document.fonts.ready.then(() => undefined), 3000);
    await bounded(
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
      1000,
    );
  });
  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
  });
  // Issue #1727: ariaSnapshotJSON() returns the same tree as ariaSnapshot()
  // but as a JSON value, so the release evidence is machine-diffable without
  // a YAML parse step.
  const ariaSnapshot = await ariaRoot.ariaSnapshotJSON({
    boxes: false,
    mode: "default",
  });
  const ariaBody = Buffer.from(JSON.stringify(ariaSnapshot ?? null, null, 2), "utf8");
  const ariaEmpty =
    ariaSnapshot == null || (Array.isArray(ariaSnapshot) && ariaSnapshot.length === 0);
  if (screenshot.length === 0 || ariaEmpty || ariaBody.length === 0) {
    throw new Error("release_artifact_empty");
  }

  await testInfo.attach(releaseArtifactName(prefix, viewport, state, "screenshot"), {
    body: screenshot,
    contentType: "image/png",
  });
  await testInfo.attach(releaseArtifactName(prefix, viewport, state, "aria"), {
    body: ariaBody,
    contentType: "application/json",
  });
}
