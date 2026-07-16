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
    "signup",
  ],
  "j2-proof": ["onboard", "invalid", "empty", "degraded", "proof"],
  "j2-activation": ["onboard", "activation-paused"],
  "j3-monitoring": ["monitoring"],
  "j3-digest": ["digest-notifications"],
  "j3-gated": ["empty-gated-recovery"],
  "j3-preseeded": ["empty-recovered"],
  "j3-privacy": ["owner-member-privacy"],
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
  return `${prefix}-${viewport}-${state}.${kind === "screenshot" ? "png" : "aria.yml"}`;
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
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
  });
  const ariaSnapshot = await ariaRoot.ariaSnapshot({
    boxes: false,
    mode: "default",
  });
  if (screenshot.length === 0 || ariaSnapshot.trim().length === 0) {
    throw new Error("release_artifact_empty");
  }

  await testInfo.attach(releaseArtifactName(prefix, viewport, state, "screenshot"), {
    body: screenshot,
    contentType: "image/png",
  });
  await testInfo.attach(releaseArtifactName(prefix, viewport, state, "aria"), {
    body: Buffer.from(ariaSnapshot, "utf8"),
    contentType: "application/yaml",
  });
}
