import { expect, test, type BrowserContext, type Page, type TestInfo } from "./helpers/release-test";
import {
  expectMinimumTouchTarget,
  expectNoHorizontalOverflow,
  expectPhoneTouchTargets,
  expectReducedMotionSafe,
  expectStatusAnnouncement,
  expectVisibleKeyboardFocus,
} from "./helpers/release-experience";
import { attachReleaseStateArtifacts } from "./helpers/release-artifacts";
import { requireExactReleaseBaseURL } from "./helpers/release-origin";

const fixtureCookie = "f9_e2e_fixture";
const fixtureModeHeader = "x-0509-e2e-test-mode";
const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 900 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

type Viewport = (typeof viewports)[number];

function annotate(testInfo: TestInfo, entries: Record<string, string>) {
  for (const [type, description] of Object.entries(entries)) {
    testInfo.annotations.push({ type, description });
  }
}

function finalPath(page: Page) {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}

function viewportKey(viewport: Viewport) {
  return `${viewport.width}x${viewport.height}`;
}

function isTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("socket hang up") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("apirequestcontext") && message.includes("post") ||
    message.includes("apirequestcontext") && message.includes("get") ||
    message.includes("net::err_connection_reset") ||
    message.includes("net::err_connection_refused") ||
    message.includes("net::err_connection_aborted")
  );
}

async function withTransportRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 2,
  delayMs = 500,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries && isTransportError(error)) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function signInAs(context: BrowserContext, baseURL: string, userId: string) {
  await context.setExtraHTTPHeaders({ [fixtureModeHeader]: "1" });
  await context.addCookies([
    {
      name: fixtureCookie,
      value: userId,
      url: requireExactReleaseBaseURL(baseURL),
      sameSite: "Lax",
    },
  ]);
}

async function expectCustomerSafeCopy(page: Page) {
  const body = await page.locator("body").innerText();
  for (const pattern of [/SQLITE_/i, /D1_ERROR/i, /stack trace/i, /Cannot read properties/i, /Stripe/i]) {
    expect(body).not.toMatch(pattern);
  }
}

async function expectExperience(page: Page) {
  await expectNoHorizontalOverflow(page);
  await expectPhoneTouchTargets(page);
  await expectReducedMotionSafe(page);
  await expectCustomerSafeCopy(page);
}

async function expectRouteAnnouncement(page: Page, text: string) {
  await expectStatusAnnouncement(
    page.locator('[role="status"]').filter({ hasText: text }),
    text,
  );
}

async function replay(
  page: Page,
  path: string,
  userId: string,
  idempotencyKey: string,
  runId: string,
  scenario: "j6",
) {
  const response = await withTransportRetry(() =>
    page.request.post(path, {
      headers: {
        [fixtureModeHeader]: "1",
        "content-type": "application/json",
      },
      data: {
        userId,
        runId,
        idempotencyKey,
        scenario,
        clock: new Date().toISOString(),
      },
    }),
  );
  expect(response.status(), `${path} replay must complete`).toBe(200);
  const body = await response.json() as Record<string, unknown>;
  expect(body.ok, `${path} replay must be acknowledged`).toBe(true);
  expect(body.provider).toMatchObject({ called: false, reason: "e2e_network_denied" });
  return body;
}

async function readState(page: Page, path: string, idempotencyKey: string, runId: string) {
  const response = await withTransportRetry(() =>
    page.request.get(
      `${path}?idempotencyKey=${encodeURIComponent(idempotencyKey)}&runId=${encodeURIComponent(runId)}`,
      { headers: { [fixtureModeHeader]: "1" } },
    ),
  );
  expect(response.status(), `${path} state must be readable`).toBe(200);
  const body = await response.json() as Record<string, unknown>;
  expect(body.ok).toBe(true);
  expect(body.provider).toMatchObject({ called: false, reason: "e2e_network_denied" });
  return body;
}

test.describe("Journey 6 release: recovery across account, support, retention, auth, and team", () => {
  for (const viewport of viewports) {
    test(`returns from dashboard to account and back (${viewport.name})`, async ({ page, context, baseURL }, testInfo) => {
      annotate(testInfo, {
        persona: "e2e-starter",
        viewport: viewportKey(viewport),
        scenario: "journey-6-returning-dashboard-account",
        checks: "keyboard-focus,live-region,touch-target,overflow,reduced-motion,customer-safe-copy",
      });
      await signInAs(context, baseURL!, "e2e-starter");
      await page.setViewportSize(viewport);
      await page.goto("/app");
      await expect(page.locator("#f9-main-content").getByRole("heading", { level: 1 })).toBeVisible();
      await page.locator('a[href="/app/settings"]:visible').first().click();
      await expect(page.getByRole("heading", { level: 1, name: "Settings", exact: true })).toBeVisible();
      await page.locator('a[href="/app/account"]:visible').first().click();
      await expect(page.getByRole("heading", { name: "Account & security" })).toBeVisible();
      await expectRouteAnnouncement(page, "Navigated to Account.");
      const website = page.getByLabel("My brand website");
      await expectVisibleKeyboardFocus(website);
      await expectMinimumTouchTarget(page.getByRole("button", { name: "Save my brand" }));
      await expectExperience(page);
      await page.locator('a[href="/app"]:visible').first().click();
      await expect(page.locator("#f9-main-content").getByRole("heading", { level: 1 })).toBeVisible();
      await expectRouteAnnouncement(page, "Navigated to App.");
      await expectExperience(page);
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j6-return", state: "dashboard-account" });
      testInfo.annotations.push({ type: "finalUrl", description: finalPath(page) });
    });

    test(`recovers account validation after an invalid value (${viewport.name})`, async ({ page, context, baseURL }, testInfo) => {
      annotate(testInfo, {
        persona: "e2e-starter",
        viewport: viewportKey(viewport),
        scenario: "journey-6-account-validation-recovery",
        checks: "keyboard-focus,live-region,touch-target,overflow,reduced-motion,customer-safe-copy",
      });
      await signInAs(context, baseURL!, "e2e-starter");
      await page.setViewportSize(viewport);
      await page.goto("/app/account");
      const form = page.locator("form").filter({ has: page.getByLabel("My brand website") });
      const website = page.getByLabel("My brand website");
      await expectVisibleKeyboardFocus(website);
      await website.fill("not-a-domain");
      await form.getByRole("button", { name: "Save my brand" }).click();
      await expectStatusAnnouncement(
        page.getByRole("alert").filter({ hasText: "That website looks incomplete." }),
        "That website looks incomplete. Add the full domain, like brand.com.",
        "alert",
      );
      await website.fill("https://starter.example.invalid");
      await form.getByRole("button", { name: "Save my brand" }).click();
      await expectStatusAnnouncement(
        page.getByRole("status").filter({ hasText: "Saved your brand website." }),
        "Saved your brand website.",
      );
      await expect(website).toHaveValue("https://starter.example.invalid");
      await expectMinimumTouchTarget(form.getByRole("button", { name: "Save my brand" }));
      await expectExperience(page);
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j6-account", state: "account-validation-recovery" });
      testInfo.annotations.push({ type: "finalUrl", description: finalPath(page) });
    });

    test(`persists support failure and recovers notification (${viewport.name})`, async ({ page, context, baseURL }, testInfo) => {
      annotate(testInfo, {
        persona: "e2e-support-recovery",
        viewport: viewportKey(viewport),
        scenario: "journey-6-support-persistence-failure-recovery",
        checks: "keyboard-focus,live-region,touch-target,overflow,reduced-motion,customer-safe-copy,provider-network-denied",
      });
      await signInAs(context, baseURL!, "e2e-support-recovery");
      await page.setViewportSize(viewport);
      await page.goto("/app/support");
      await expect(page.getByRole("heading", { name: "Help & support" })).toBeVisible();
      await expect(page.getByText("Fixture operator notification recovery")).toBeVisible();
      const subject = `Journey 6 ${viewport.name} support persistence`;
      await expectVisibleKeyboardFocus(page.getByLabel("Subject"));
      await page.getByLabel("Subject").fill(subject);
      await page.getByLabel("Details").fill("Deterministic local support persistence check.");
      await page.getByRole("button", { name: "Open support case" }).click();
      await expect(page.getByText(/Support case saved, but we could not notify support\./)).toBeVisible();
      await expectStatusAnnouncement(
        page.locator('[role="alert"]').filter({ hasText: "Support case saved, but we could not notify support." }),
        /Support case saved, but we could not notify support\./,
        "alert",
      );
      await expect(page.getByRole("link", { name: new RegExp(subject) })).toBeVisible();
      await expectMinimumTouchTarget(page.getByRole("button", { name: "Open support case" }));

      const token = viewportKey(viewport);
      const failureKey = `e2e-j6-support-failure-${token}`;
      const failureRun = `e2e-run-j6-support-failure-${token}`;
      const recoveryKey = `e2e-j6-support-recovery-${token}`;
      const recoveryRun = `e2e-run-j6-support-recovery-${token}`;
      await expect((await replay(page, "/api/e2e/support/replay", "e2e-support-recovery", failureKey, failureRun, "j6")).outcome).toBe("failure");
      await expect((await replay(page, "/api/e2e/support/replay", "e2e-support-recovery", recoveryKey, recoveryRun, "j6")).outcome).toBe("recovery");
      const state = await readState(page, "/api/e2e/support/state", recoveryKey, recoveryRun);
      expect(state).toMatchObject({
        outcome: "recovery",
        attempt: { owned: true, status: "sent", webhookStatus: "delivered", provider: "cloudflare_email", casePayloadMatched: true },
      });
      expect(state.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ eventType: "support_notification_failed" }),
        expect.objectContaining({ eventType: "support_notified" }),
      ]));
      await page.getByRole("link", { name: /Fixture operator notification recovery/ }).click();
      await expect(page.getByRole("region", { name: "Selected support case" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Notification issue" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Support notified" })).toBeVisible();
      await expect(page.getByText("Support notification recovered.")).toBeVisible();
      await expectExperience(page);
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j6-support", state: "support-failure-recovery" });
      testInfo.annotations.push({ type: "finalUrl", description: finalPath(page) });
    });

    test(`runs retention failure and scratch restore recovery (${viewport.name})`, async ({ page, context, baseURL }, testInfo) => {
      annotate(testInfo, {
        persona: "e2e-starter",
        viewport: viewportKey(viewport),
        scenario: "journey-6-retention-scratch-restore-integrity",
        checks: "keyboard-focus,touch-target,overflow,reduced-motion,customer-safe-copy,provider-network-denied",
      });
      await signInAs(context, baseURL!, "e2e-starter");
      await page.setViewportSize(viewport);
      await page.goto("/app");
      await expect(page.locator("#f9-main-content").getByRole("heading", { level: 1 })).toBeVisible();
      const token = viewportKey(viewport);
      const failureKey = `e2e-j6-retention-failure-${token}`;
      const failureRun = `e2e-run-j6-retention-failure-${token}`;
      const recoveryKey = `e2e-j6-retention-recovery-${token}`;
      const recoveryRun = `e2e-run-j6-retention-recovery-${token}`;
      const failure = await replay(page, "/api/e2e/retention/replay", "e2e-starter", failureKey, failureRun, "j6");
      expect(failure).toMatchObject({
        outcome: "failure",
        failedSteps: ["discovery_cache_entry"],
        recoveryRequired: true,
        fixture: { rowsBefore: 1, rowsAfter: 1 },
      });
      const recovery = await replay(page, "/api/e2e/retention/replay", "e2e-starter", recoveryKey, recoveryRun, "j6");
      expect(recovery).toMatchObject({
        outcome: "recovery",
        failedSteps: [],
        recoveryRequired: false,
        fixture: { rowsBefore: 1, rowsAfter: 0, discoveryCacheDeleted: 1 },
      });
      const state = await readState(page, "/api/e2e/retention/state", recoveryKey, recoveryRun);
      expect(state).toMatchObject({ outcome: "recovery", fixture: { rowsBefore: 1, rowsAfter: 0 } });
      await expectVisibleKeyboardFocus(page.locator('a[href="/app/settings"]:visible').first());
      await page.locator('a[href="/app/settings"]:visible').first().click();
      await expect(page.getByRole("heading", { level: 1, name: "Settings", exact: true })).toBeVisible();
      await page.locator('a[href="/app/account"]:visible').first().click();
      await expect(page.getByRole("heading", { name: "Account & security" })).toBeVisible();
      await expectRouteAnnouncement(page, "Navigated to Account.");
      await page.locator('a[href="/app"]:visible').first().click();
      await expect(page.locator("#f9-main-content").getByRole("heading", { level: 1 })).toBeVisible();
      await expectRouteAnnouncement(page, "Navigated to App.");
      await expectExperience(page);
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j6-retention", state: "retention-restore-integrity" });
      testInfo.annotations.push({ type: "finalUrl", description: finalPath(page) });
    });

    test(`shows a safe auth outage and recovers the same session (${viewport.name})`, async ({ page, context, baseURL }, testInfo) => {
      annotate(testInfo, {
        persona: "e2e-starter",
        viewport: viewportKey(viewport),
        scenario: "journey-6-auth-backend-outage-recovery",
        checks: "keyboard-focus,live-region,touch-target,overflow,reduced-motion,customer-safe-copy,provider-network-denied",
      });
      await signInAs(context, baseURL!, "e2e-starter");
      await page.setViewportSize(viewport);
      await page.goto("/app");
      await expect(page.locator("#f9-main-content").getByRole("heading", { level: 1 })).toBeVisible();
      const token = viewportKey(viewport);
      const outageKey = `e2e-j6-auth-outage-${token}`;
      const outageRun = `e2e-run-j6-auth-outage-${token}`;
      const recoveryKey = `e2e-j6-auth-recovery-${token}`;
      const recoveryRun = `e2e-run-j6-auth-recovery-${token}`;
      const outage = await replay(page, "/api/e2e/auth/replay", "e2e-starter", outageKey, outageRun, "j6");
      expect(outage).toMatchObject({ action: "auth_outage", outcome: "outage", auth: { status: "unavailable" } });
      await context.setExtraHTTPHeaders({ [fixtureModeHeader]: "1", "x-0509-e2e-auth-fault": "unavailable" });
      await page.goto("/app");
      await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toBeVisible();
      await expect(page.getByRole("alert")).toContainText("Authentication is temporarily unavailable. Please try again in a moment.");
      await expectVisibleKeyboardFocus(page.getByRole("alert"));
      await expectExperience(page);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1, name: /saved the proof|before the call/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toHaveCount(0);
      await context.setExtraHTTPHeaders({ [fixtureModeHeader]: "1" });
      const recovery = await replay(page, "/api/e2e/auth/replay", "e2e-starter", recoveryKey, recoveryRun, "j6");
      expect(recovery).toMatchObject({ action: "auth_recovery", outcome: "recovery", auth: { status: "recovered" } });
      await page.goto("/app");
      await expect(page.locator("#f9-main-content").getByRole("heading", { level: 1 })).toBeVisible();
      await expectVisibleKeyboardFocus(page.locator('a[href="/app/settings"]:visible').first());
      await expectExperience(page);
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j6-auth", state: "auth-outage-recovery" });
      testInfo.annotations.push({ type: "finalUrl", description: finalPath(page) });
    });

    test(`recovers concurrent team invites and stale conflicts (${viewport.name})`, async ({ page, context, baseURL }, testInfo) => {
      annotate(testInfo, {
        persona: "e2e-agency",
        viewport: viewportKey(viewport),
        scenario: "journey-6-owner-member-invite-concurrency-stale-conflicts",
        checks: "keyboard-focus,touch-target,overflow,reduced-motion,customer-safe-copy,provider-network-denied",
      });
      await signInAs(context, baseURL!, "e2e-agency");
      await page.setViewportSize(viewport);
      await page.goto("/app/team");
      await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
      await expect(page.getByText("e2e-active-member@example.invalid")).toBeVisible();
      await expect(page.getByText("e2e-removed-member@example.invalid")).toHaveCount(0);
      const token = viewportKey(viewport);
      const idempotencyKey = `e2e-j6-team-invite-${token}`;
      const runId = `e2e-run-j6-team-invite-${token}`;
      const replayResult = await replay(page, "/api/e2e/team/replay", "e2e-agency", idempotencyKey, runId, "j6");
      expect(replayResult).toMatchObject({
        action: "team_invite_concurrency_recovery",
        concurrency: { attempted: 2, successes: 1, failures: 1, exactlyOneSuccess: true },
        rotation: { created: true, resent: true, staleTokenRejected: true, currentTokenAccepted: true, tokenHashCleared: true },
        revoke: { acceptedMemberRevoked: true, staleRevoke: false, staleResend: false, acceptAfterRevoke: false },
      });
      const state = await readState(page, "/api/e2e/team/state", idempotencyKey, runId);
      expect(state).toMatchObject({ action: "team_invite_concurrency_recovery", concurrency: { exactlyOneSuccess: true }, rotation: { staleTokenRejected: true } });
      await page.locator('a[href="/app/settings"]:visible').first().click();
      await expect(page.getByRole("heading", { level: 1, name: "Settings", exact: true })).toBeVisible();
      await page.locator('a[href="/app/account"]:visible').first().click();
      await expect(page.getByRole("heading", { name: "Account & security" })).toBeVisible();
      await expectRouteAnnouncement(page, "Navigated to Account.");
      await page.locator('a[href="/app/settings"]:visible').first().click();
      await expect(page.getByRole("heading", { level: 1, name: "Settings", exact: true })).toBeVisible();
      await page.locator('a[href="/app/team"]:visible').first().click();
      await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
      await expectRouteAnnouncement(page, "Navigated to Team.");
      await expectVisibleKeyboardFocus(page.getByLabel("Teammate email"));
      await expectExperience(page);
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j6-team", state: "invite-concurrency-recovery" });
      testInfo.annotations.push({ type: "finalUrl", description: finalPath(page) });
    });
  }
});
