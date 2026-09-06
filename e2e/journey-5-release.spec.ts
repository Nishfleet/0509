import { expect, test, type BrowserContext, type Page, type TestInfo } from "./helpers/release-test";
import { billingSkuForPlanCheckout } from "../app/lib/billing-sku-catalog";
import { attachReleaseStateArtifacts } from "./helpers/release-artifacts";
import {
  expectNoHorizontalOverflow,
  expectPhoneTouchTargets,
  expectPrimaryActionAboveFold,
  expectReducedMotionSafe,
  expectVisibleKeyboardFocus,
  focusAdvanceKey,
} from "./helpers/release-experience";
import { requireExactReleaseBaseURL } from "./helpers/release-origin";

const fixtureCookie = "f9_e2e_fixture";
const fixtureModeHeader = "x-0509-e2e-test-mode";
const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 900 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

function paymentIssueUser(viewport: (typeof viewports)[number]) {
  return viewport.name === "tablet"
    ? "e2e-payment-issue-tablet"
    : viewport.name === "desktop"
      ? "e2e-payment-issue-desktop"
      : "e2e-payment-issue";
}

function cancelledUser(viewport: (typeof viewports)[number]) {
  return viewport.name === "tablet"
    ? "e2e-cancelled-tablet"
    : viewport.name === "desktop"
      ? "e2e-cancelled-desktop"
      : "e2e-cancelled";
}

function refundedUser(viewport: (typeof viewports)[number]) {
  return viewport.name === "tablet"
    ? "e2e-refunded-tablet"
    : viewport.name === "desktop"
      ? "e2e-refunded-desktop"
      : "e2e-refunded";
}

function annotate(testInfo: TestInfo, entries: Record<string, string>) {
  for (const [type, description] of Object.entries(entries)) {
    testInfo.annotations.push({ type, description });
  }
}

function finalPath(page: Page) {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
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

async function expectTouchTargets(page: Page) {
  await expectPhoneTouchTargets(page);
}

async function expectKeyboardFocus(page: Page) {
  const browserName = page.context().browser()?.browserType().name();
  await page.keyboard.press(focusAdvanceKey(browserName));
  const control = page.locator(":focus");
  await expect(control).toBeVisible();
  const focusStyle = await control.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return style.outlineStyle !== "none" || style.boxShadow !== "none";
  });
  expect(focusStyle, "the focused billing control should retain a visible focus treatment").toBe(true);
}

async function expectCustomerSafeCopy(page: Page) {
  const body = await page.locator("body").innerText();
  for (const pattern of [/SQLITE_/i, /D1_ERROR/i, /stack trace/i, /Cannot read properties/i, /Stripe/i]) {
    expect(body).not.toMatch(pattern);
  }
}

async function invokeBillingReplay(page: Page, viewport: (typeof viewports)[number]) {
  const runId = `e2e-run-j5-billing-lifecycle-${viewport.width}x${viewport.height}`;
  const idempotencyKey = `e2e-j5-billing-lifecycle-${viewport.width}x${viewport.height}`;
  const userId = paymentIssueUser(viewport);
  const response = await page.evaluate(async ({ runId, idempotencyKey, userId }) => {
    const result = await fetch("/api/e2e/billing/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId,
        runId,
        idempotencyKey,
        scenario: "j5",
        clock: new Date().toISOString(),
      }),
    });
    return { status: result.status, body: await result.json() };
  }, { runId, idempotencyKey, userId }) as { status: number; body: Record<string, unknown> };
  expect(
    response.status,
    `signed billing replay must complete in the denied local harness (${String(response.body.blocker ?? "unknown")})`,
  ).toBe(200);
  expect(response.body.ok).toBe(true);
  expect(response.body.provider).toMatchObject({ called: false, reason: "e2e_network_denied" });
  expect(response.body.commercialProviderReplay).toMatchObject({
    checkout: {
      accepted: true,
      canonicalSku: "starter_monthly_v1",
      safeHostedUrl: true,
    },
    planChange: {
      previewed: true,
      tokenVerified: true,
      accepted: true,
      claimAccepted: true,
      canonicalSku: "agency_monthly_v1",
    },
    syntheticCallCount: 4,
    externalProviderCalled: false,
    entitlementReconciled: true,
  });
  expect(response.body.cleanup).toMatchObject({ rawProviderIdsExposed: false, secretsExposed: false, piiExposed: false });
  return response.body as Record<string, any>;
}

async function readBillingState(page: Page, userId: string) {
  const response = await page.evaluate(async (userId) => {
    const result = await fetch(`/api/e2e/billing/state?user_id=${encodeURIComponent(userId)}`);
    return { status: result.status, body: await result.json() };
  }, userId) as { status: number; body: Record<string, unknown> };
  expect(response.status).toBe(200);
  expect(response.body.ok).toBe(true);
  expect(response.body.provider).toMatchObject({ called: false, reason: "e2e_network_denied" });
  return response.body as Record<string, any>;
}

// Shared-resource lock (issue #1727): the billing replay mutates shared
// fixture baselines (postflight expects billingReplayBaselines:3) and the
// same describe runs under five engine projects.
test.describe("Journey 5 release: plan, checkout, entitlements, billing", { lock: "d1" }, () => {
  for (const viewport of viewports) {
    test(`holds plan boundaries and proves entitlement display (${viewport.name})`, async ({
      page,
      context,
      baseURL,
    }, testInfo) => {
      annotate(testInfo, {
        persona: "e2e-free-onboarded,e2e-starter",
        viewport: `${viewport.width}x${viewport.height}`,
        scenario: "journey-5-plan-boundary-entitlement",
      });
      await signInAs(context, baseURL!, "e2e-free-onboarded");
      await page.setViewportSize(viewport);
      await page.goto("/app/billing?plan=starter&cycle=monthly&source=e2e#plans");

      await expect(page.getByRole("heading", { name: "Billing & usage" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Pick a plan and billing cycle" })).toBeVisible();
      const cycleGroup = page.getByRole("group", { name: "Billing cycle" });
      const monthly = cycleGroup.getByRole("link", { name: "Monthly" });
      const annual = cycleGroup.getByRole("link", { name: "Annual" });
      await expect(monthly).toHaveAttribute("aria-current", "true");
      await annual.focus();
      await expect(annual).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/cycle=yearly/);
      await expect(cycleGroup.getByRole("link", { name: "Annual" })).toHaveAttribute("aria-current", "true");
      await expectKeyboardFocus(page);
      await expectNoHorizontalOverflow(page);
      await expectTouchTargets(page);
      await expectReducedMotionSafe(page);
      await expectCustomerSafeCopy(page);

      // A local fixture must show the complete boundary before any checkout control is activated.
      await page.goto("/app/billing?plan=starter&cycle=monthly&source=e2e#plans");
      const starterCard = page.locator("section.f9-wk-plan-card").filter({ hasText: /^Starter/ }).first();
      await expect(starterCard).toBeVisible();
      await expect(starterCard.getByLabel("Starter limits")).toContainText("10 watchlists");
      await expect(starterCard.getByLabel("Starter limits")).toContainText("250 proof captures/mo");
      const checkoutForm = starterCard.locator('form[action="/api/billing/dodo/checkout"]');
      // The isolated local release harness intentionally has no Dodo API key
      // or product ids. Assert that honest unavailable state exactly; a
      // checkout form would require an explicit provider-configured proof run.
      await expect(checkoutForm).toHaveCount(0);
      await expect(starterCard.getByRole("button", { name: "Waiting for the live price", exact: true })).toBeDisabled();
      expect(billingSkuForPlanCheckout("starter", "monthly")).toBe("starter_monthly_v1");
      testInfo.annotations.push({
        type: "canonicalSku",
        description: "starter_monthly_v1 (registry truth; checkout form unavailable in provider-denied local harness)",
      });

      await signInAs(context, baseURL!, "e2e-starter");
      await page.goto("/app/billing");
      await expect(page.getByRole("heading", { name: "Starter plan — free account" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Starter plan" })).toBeVisible();
      await expect(page.getByText("Current plan").first()).toBeVisible();
      await expect(page.getByText("purchased proof captures remaining")).toBeVisible();
      await expect(page.getByText("Change, cancel, or get invoices")).toBeVisible();
      await expect(page.getByText("Dodo Payments emails a receipt for every charge.")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectTouchTargets(page);
      await expectCustomerSafeCopy(page);
      await attachReleaseStateArtifacts({
        page,
        testInfo,
        prefix: "j5-plan",
        state: "plan-boundary-entitlement",
      });
      testInfo.annotations.push({ type: "finalUrl", description: finalPath(page) });
    });
  }

  for (const viewport of viewports) {
    test(`reads signed lifecycle fixture states without simulating provider transitions (${viewport.name})`, async ({
      page,
      context,
      baseURL,
    }, testInfo) => {
      annotate(testInfo, {
        persona: `${paymentIssueUser(viewport)},${cancelledUser(viewport)},${refundedUser(viewport)}`,
        viewport: `${viewport.width}x${viewport.height}`,
        scenario: "journey-5-signed-lifecycle-readback",
      });
      await page.setViewportSize(viewport);

      const paymentUser = paymentIssueUser(viewport);
      await signInAs(context, baseURL!, paymentUser);
      await page.goto("/app/billing");
      const replay = await invokeBillingReplay(page, viewport);
      expect(replay.lifecycle).toMatchObject({
        activationDuplicate: true,
        paymentFailedRecovered: true,
        cancellationScheduledReversed: true,
        missingNullNoReversal: true,
        olderNoRegression: true,
        planChangeApplied: true,
        cancelledExpiredRevoked: true,
        fullRefundRevoked: true,
        partialAndFailedNoMutation: true,
      });
      const paymentState = await readBillingState(page, paymentUser);
      expect(paymentState.entitlement).toMatchObject({ plan: "starter", status: "active" });
      expect(paymentState.ledger.processed).toBeGreaterThan(0);

      await page.goto("/app/billing");
      await expect(page.getByRole("heading", { name: "Starter plan" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Plan active" })).toBeVisible();
      await expectPrimaryActionAboveFold(
        page.getByRole("article", { name: "Plan active" })
          .getByRole("button", { name: "Open billing portal" }),
        "current billing management action",
      );
      await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Dodo Payments emails a receipt for every charge.")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectTouchTargets(page);
      await expectCustomerSafeCopy(page);
      await attachReleaseStateArtifacts({
        page,
        testInfo,
        prefix: "j5-lifecycle",
        state: "payment-recovered",
      });

      const cancelledFixtureUser = cancelledUser(viewport);
      await signInAs(context, baseURL!, cancelledFixtureUser);
      const cancelledState = await readBillingState(page, cancelledFixtureUser);
      expect(cancelledState.entitlement).toMatchObject({ plan: "free", status: "subscription.cancelled" });
      await page.goto("/app/billing");
      await expect(page.getByRole("heading", { name: "Free plan — free account" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Paid access has ended." })).toBeVisible();
      await expect(page.getByText("Cancelled — on the free account", { exact: true })).toBeVisible();
      await expect(page.getByText("This account is on the free plan after the subscription was cancelled.")).toBeVisible();
      await expect(page.getByText("Paid access has ended. Choose a plan to start again.")).toBeVisible();
      await expectPrimaryActionAboveFold(
        page.getByRole("link", { name: "Choose a plan" }).first(),
        "cancelled-plan recovery action",
      );
      await expectNoHorizontalOverflow(page);
      await expectTouchTargets(page);
      await expectCustomerSafeCopy(page);
      await attachReleaseStateArtifacts({
        page,
        testInfo,
        prefix: "j5-lifecycle",
        state: "cancelled",
      });

      const refundedFixtureUser = refundedUser(viewport);
      await signInAs(context, baseURL!, refundedFixtureUser);
      const refundedState = await readBillingState(page, refundedFixtureUser);
      expect(refundedState.entitlement).toMatchObject({ plan: "free", status: "refunded" });
      await page.goto("/app/billing");
      await expect(page.getByRole("heading", { name: "Free plan — free account" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Paid access has ended." })).toBeVisible();
      await expect(page.getByText("Refunded — reverted to the free account", { exact: true })).toBeVisible();
      await expect(page.getByText("The refunded payment no longer provides paid-plan access.")).toBeVisible();
      const refundedRecoveryAction = page.getByRole("link", { name: "Choose a plan" }).first();
      await expectPrimaryActionAboveFold(
        refundedRecoveryAction,
        "refunded-plan recovery action",
      );
      await expect(
        page.getByText(
          "Questions about a charge, cancellation, or refund?",
          { exact: false },
        ),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "open a billing support case", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "current Terms" })).toBeVisible();
      await expectVisibleKeyboardFocus(refundedRecoveryAction);
      await expectTouchTargets(page);
      await expectNoHorizontalOverflow(page);
      await expectReducedMotionSafe(page);
      await expectCustomerSafeCopy(page);
      await attachReleaseStateArtifacts({
        page,
        testInfo,
        prefix: "j5-lifecycle",
        state: "refunded",
      });
      testInfo.annotations.push({ type: "finalUrl", description: finalPath(page) });
    });
  }
});
