import { expect, test, type BrowserContext, type Page } from "./helpers/release-test";
import { requireExactReleaseBaseURL } from "./helpers/release-origin";
import { attachReleaseStateArtifacts } from "./helpers/release-artifacts";
import {
  expectNoHorizontalOverflow,
  expectPhoneTouchTargets,
  expectVisibleKeyboardFocus,
} from "./helpers/release-experience";

const fixtureCookie = "f9_e2e_fixture";
const fixtureModeHeader = "x-0509-e2e-test-mode";

async function signInAs(context: BrowserContext, baseURL: string, userId: string) {
  const url = requireExactReleaseBaseURL(baseURL);
  await context.setExtraHTTPHeaders({ [fixtureModeHeader]: "1" });
  await context.addCookies([{ name: fixtureCookie, value: userId, url, sameSite: "Lax" }]);
}

async function runJ3Replay(
  page: Page,
  input: {
    idempotencyKey: string;
    userId: string;
    scenario: "monitoring" | "digest";
  },
) {
  const requestBody = {
    userId: input.userId,
    runId: input.idempotencyKey.replace(/^e2e-j3-/u, "e2e-run-j3-"),
    idempotencyKey: input.idempotencyKey,
    scenario: "j3",
    clock: new Date().toISOString(),
  };
  const first = await page.request.post("/api/e2e/j3/replay", {
    headers: { [fixtureModeHeader]: "1" },
    data: requestBody,
  });
  expect(first.status(), `${input.scenario} replay must complete`).toBe(200);
  const firstBody = await first.json() as Record<string, unknown>;
  expect(firstBody).toMatchObject({ ok: true, replayed: false });

  const repeated = await page.request.post("/api/e2e/j3/replay", {
    headers: { [fixtureModeHeader]: "1" },
    data: requestBody,
  });
  expect(repeated.status(), `${input.scenario} replay retry must complete`).toBe(200);
  const repeatedBody = await repeated.json() as Record<string, unknown>;
  expect(repeatedBody).toMatchObject({ ok: true, replayed: true });
  expect({ ...repeatedBody, replayed: false }).toEqual(firstBody);
  return firstBody;
}

async function expectResponsiveSurface(
  page: Page,
  viewport: { width: number; height: number },
  route: string,
  heading: string,
  copy: RegExp[],
) {
  await page.setViewportSize(viewport);
  await page.goto(route);
  // Dashboard surfaces render the page title as the sole level-1 heading; pin
  // it so a duplicated section heading (e.g. the Competitors list panel h2)
  // can't satisfy — or ambiguate — this assertion.
  await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
  for (const pattern of copy) await expect(page.locator("body")).toContainText(pattern);
  const firstAction = page.locator("a, button, input, select, textarea").filter({ visible: true }).first();
  await expectVisibleKeyboardFocus(firstAction);
  await expectNoHorizontalOverflow(page);
  await expectPhoneTouchTargets(page);
}

function annotateScenario(testInfo: { annotations: Array<{ type: string; description?: string }> }, scenario: string) {
  testInfo.annotations.push({ type: "scenario", description: scenario });
}

function annotateFinalUrl(testInfo: { annotations: Array<{ type: string; description?: string }> }, page: Page) {
  const url = new URL(page.url());
  testInfo.annotations.push({ type: "finalUrl", description: `${url.pathname}${url.search}` });
}

const monitoringViewports = [
  { width: 375, height: 812 },
  { width: 768, height: 900 },
  { width: 1440, height: 900 },
] as const;

test.describe("Gate-B Journey 3 — monitoring, alerts, and digests", () => {
  for (const viewport of monitoringViewports) {
    test(`starter monitoring preserves proof, freshness, and delivery at ${viewport.width}px`, async ({
      page,
      context,
      baseURL,
    }, testInfo) => {
      annotateScenario(testInfo, "monitoring-proof-freshness-delivery");
      testInfo.annotations.push({ type: "persona", description: "e2e-starter" });
      testInfo.annotations.push({ type: "viewport", description: `${viewport.width}x${viewport.height}` });
      await signInAs(context, baseURL!, "e2e-starter");
      const viewportKey = `${viewport.width}x${viewport.height}`;
      const workflowAcceptance = await runJ3Replay(page, {
        idempotencyKey: `e2e-j3-workflow-accept-monitoring-${viewportKey}`,
        userId: "e2e-starter",
        scenario: "monitoring",
      });
      expect(workflowAcceptance).toMatchObject({
        workflowAccepted: true,
      });
      await expectResponsiveSurface(
        page,
        viewport,
        "/app/watchlists?watchlist=e2e-watchlist-j3-workflow",
        "Competitors",
        [/(first scan is in line and starts automatically|first scan paused safely before an external check)/i],
      );
      await expect(
        page.getByRole("heading", { name: /First scan (starts shortly|safely paused)/ }),
      ).toBeVisible();
      await expect(page.getByText(/running now/i)).toHaveCount(0);

      const crashReclaim = await runJ3Replay(page, {
        idempotencyKey: `e2e-j3-crash-reclaim-monitoring-${viewportKey}`,
        userId: "e2e-starter",
        scenario: "monitoring",
      });
      expect(crashReclaim).toMatchObject({
        staleOwnerRejected: true,
        reservationAdopted: true,
        run: { status: "running" },
      });
      await expectResponsiveSurface(
        page,
        viewport,
        "/app/watchlists?watchlist=e2e-watchlist-j3-crash",
        "Competitors",
        [/Scanning this competitor now/, /first scan is running now/i],
      );
      await expect(page.getByText("Still running", { exact: true })).toBeVisible();
      await expect(runJ3Replay(page, {
        idempotencyKey: `e2e-j3-reconcile-monitoring-${viewportKey}`,
        userId: "e2e-starter",
        scenario: "monitoring",
      })).resolves.toMatchObject({ released: true, reservationStatus: "released" });
      await expect(runJ3Replay(page, {
        idempotencyKey: `e2e-j3-recover-monitoring-${viewportKey}`,
        userId: "e2e-starter",
        scenario: "monitoring",
      })).resolves.toMatchObject({ cleanupVerified: true, includedUsed: 0 });
      await expectResponsiveSurface(page, viewport, "/app/watchlists?watchlist=e2e-watchlist-starter-1", "Competitors", [
        /Okara competitor watch/,
        /Evidence and alerts/,
        /Evidence freshness/,
        /confirmed/i,
      ]);

      await expect(page.getByText("Last good evidence check", { exact: false })).toBeVisible();
      await expect(page.getByRole("link", { name: /Workflow acceptance watch/ })).toContainText(
        "No completed check yet — open for status",
      );
      await expect(page.getByRole("link", { name: /Crash reclaim watch/ })).toContainText(
        "No completed check yet — open for status",
      );
      await expect(page.getByText("Confidence pending", { exact: false }).first()).toBeVisible();
      await expect(page.getByText("Monitoring history is saved; new checks need source access", { exact: true })).toBeVisible();
      await expect(page.getByText("Needs source access", { exact: true })).toBeVisible();
      await expect(page.getByText("After source access is ready", { exact: true })).toBeVisible();
      await expect(page.getByText("High-priority alerts (sent as soon as a scan confirms a major change)")).toBeVisible();
      await expect(page.getByRole("checkbox", { name: /High-priority alerts/ })).toBeChecked();
      await expect(page.getByText("Succeeded · Scheduled scan", { exact: true })).toBeVisible();
      await expect(page.getByText("Failed · Scheduled scan", { exact: true })).toBeVisible();
      await expect(page.getByText("This scan failed. Check Source access, then retry — or email support and we'll dig in.", { exact: true })).toBeVisible();
      await expect(page.getByText(/1 ads seen/)).toBeVisible();
      await expect(page.getByText("Verified from a page snapshot", { exact: false }).first()).toBeVisible();
      await expect(page.getByText("No alert sent for this change yet.", { exact: true }).first()).toBeVisible();
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j3-monitoring", state: "monitoring" });
      annotateFinalUrl(testInfo, page);
    });
  }

  for (const viewport of monitoringViewports) {
    test(`digest and notifications surfaces preserve accessible delivery announcements and source truth at ${viewport.width}px`, async ({
      page,
      context,
      baseURL,
    }, testInfo) => {
      annotateScenario(testInfo, "digest-notifications-accessibility");
      testInfo.annotations.push({ type: "persona", description: "e2e-starter" });
      testInfo.annotations.push({ type: "viewport", description: `${viewport.width}x${viewport.height}` });
      await signInAs(context, baseURL!, "e2e-starter");
      const viewportKey = `${viewport.width}x${viewport.height}`;
      await expect(runJ3Replay(page, {
        idempotencyKey: `e2e-j3-delivery-denied-digest-${viewportKey}`,
        userId: "e2e-starter",
        scenario: "digest",
      })).resolves.toMatchObject({
        providerCalled: false,
        verifiedRecipientBound: true,
        attemptCount: 1,
        status: "failed",
        webhookStatus: "failed",
      });
      await signInAs(context, baseURL!, "e2e-free");
      await expect(runJ3Replay(page, {
        idempotencyKey: `e2e-j3-unsubscribe-cas-digest-${viewportKey}`,
        userId: "e2e-free",
        scenario: "digest",
      })).resolves.toMatchObject({
        unsubscribeWon: true,
        dispatchStarted: false,
        attemptStatus: "failed",
        cleanupVerified: true,
      });
      await signInAs(context, baseURL!, "e2e-starter");
      await expect(runJ3Replay(page, {
        idempotencyKey: `e2e-j3-recover-digest-${viewportKey}`,
        userId: "e2e-starter",
        scenario: "digest",
      })).resolves.toMatchObject({ cleanupVerified: true, includedUsed: 0 });
      await expectResponsiveSurface(page, viewport, "/app/digests", "Briefs", [
        /Brief history/,
        /Okara launched a new workflow offer/,
        /sent/i,
      ]);
      await expect(page.getByText("proof", { exact: false }).first()).toBeVisible();
      await expect(page.getByText("Sent", { exact: true })).toBeVisible();
      await expect(page.getByText("Configured email recipient", { exact: true })).toBeVisible();

      await expectResponsiveSurface(page, viewport, "/app/notifications", "Notifications", [
        /Digest and alert delivery/,
        /Email/,
        /Ready/,
        /Configurable/,
      ]);
      await page.goto("/unsubscribe");
      await expect(page.getByRole("heading", { name: "This unsubscribe link isn't valid.", exact: true })).toBeVisible();
      await expect(page.locator("body")).toContainText(/link may be incomplete or expired/i);
      await expectVisibleKeyboardFocus(page.locator("a").first());
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);
      await page.goto("/app/notifications");
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j3-digest", state: "digest-notifications" });
      annotateFinalUrl(testInfo, page);
    });
  }

  for (const viewport of monitoringViewports) {
    test(`empty, gated, and recovery states remain honest before any delivery action at ${viewport.width}px`, async ({ page, context, baseURL }, testInfo) => {
      annotateScenario(testInfo, "empty-gated-recovery-before-delivery");
      testInfo.annotations.push({ type: "persona", description: "e2e-free-onboarded,e2e-scout" });
      testInfo.annotations.push({ type: "viewport", description: `${viewport.width}x${viewport.height}` });
      await signInAs(context, baseURL!, "e2e-free-onboarded");
      await page.setViewportSize(viewport);
      await page.goto("/app/digests");
      // Free Weekly Competitor Watch: the free plan now includes a weekly
      // brief, so /app/digests is a real (empty) surface, not a paid gate.
      await expect(page.getByRole("heading", { name: "Briefs", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Brief history", exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Your first brief lands after the first scan", exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText("Briefs are included in paid plans")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);

      await page.goto("/app/watchlists");
      await expect(page.getByText("Add your first competitor", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Add competitor" }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);

      await signInAs(context, baseURL!, "e2e-scout");
      await page.goto("/app/watchlists?watchlist=e2e-watchlist-scout-1");
      await expect(page.getByText("High-priority alerts require Starter", { exact: false })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: /High-priority alerts/ })).toBeDisabled();
      await expect(page.getByText("Email delivery requires Scout", { exact: false })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j3-gated", state: "empty-gated-recovery" });
      annotateFinalUrl(testInfo, page);
    });
  }

  for (const viewport of monitoringViewports) {
    test(`pre-seeded empty and recovered monitoring states stay explicit without provider mutation at ${viewport.width}px`, async ({
      page,
      context,
      baseURL,
    }, testInfo) => {
      annotateScenario(testInfo, "preseeded-empty-and-recovered-monitoring-states");
      testInfo.annotations.push({ type: "persona", description: "e2e-free-onboarded,e2e-starter" });
      testInfo.annotations.push({ type: "viewport", description: `${viewport.width}x${viewport.height}` });
      await signInAs(context, baseURL!, "e2e-free-onboarded");
      await page.setViewportSize(viewport);
      await page.goto("/app/watchlists");
      await expect(page.getByText("Add your first competitor", { exact: true }).first()).toBeVisible();

      await signInAs(context, baseURL!, "e2e-starter");
      await page.goto("/app/watchlists?watchlist=e2e-watchlist-starter-1");
      await expect(page.getByText("Okara launched a new workflow offer", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Verified from a page snapshot", { exact: false }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j3-preseeded", state: "empty-recovered" });
      annotateFinalUrl(testInfo, page);
    });
  }

  for (const viewport of monitoringViewports) {
    test(`agency owner and member delivery privacy at ${viewport.width}px`, async ({ page, context, baseURL }, testInfo) => {
      annotateScenario(testInfo, "owner-member-delivery-privacy");
      testInfo.annotations.push({ type: "persona", description: "e2e-agency,e2e-active-member" });
      testInfo.annotations.push({ type: "viewport", description: `${viewport.width}x${viewport.height}` });

      await signInAs(context, baseURL!, "e2e-agency");
      await expectResponsiveSurface(page, viewport, "/app/watchlists?watchlist=e2e-watchlist-agency-1", "Competitors", [
        /Agency client proof watch/,
        /Targets and pauses/,
      ]);
      await expect(page.locator('input[name="targetValue"]')).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Save delivery settings", exact: true })).toHaveCount(1);

      await signInAs(context, baseURL!, "e2e-active-member");
      await page.goto("/app/watchlists?watchlist=e2e-watchlist-agency-1");
      await expect(page.getByRole("heading", { level: 1, name: "Competitors", exact: true })).toBeVisible();
      await expect(page.getByText("Delivery settings and recipient targets are managed by the workspace owner.", { exact: true })).toBeVisible();
      await expect(page.locator('input[name="targetValue"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save delivery settings", exact: true })).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("e2e-starter@example.invalid");
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j3-privacy", state: "owner-member-privacy" });
      annotateFinalUrl(testInfo, page);
    });
  }

  for (const viewport of monitoringViewports) {
    test(`WP-C2 first-run wait arc keeps queued/running + Free capacity honest at ${viewport.width}px`, async ({ page, context, baseURL }, testInfo) => {
      annotateScenario(testInfo, "first-run-wait-arc-and-free-capacity");
      testInfo.annotations.push({ type: "persona", description: "e2e-free-firstscan" });
      testInfo.annotations.push({ type: "viewport", description: `${viewport.width}x${viewport.height}` });
      await signInAs(context, baseURL!, "e2e-free-firstscan");
      await page.setViewportSize(viewport);

      // Overview Beat 2: a competitor is added and the first scan is in flight.
      // The Overview mirror must not claim the scan is confirmed running, and a
      // one-watchlist Free plan is at capacity -> upgrade affordance, never an
      // add form that would be rejected.
      await page.goto("/app");
      await expect(page.getByRole("heading", { level: 1, name: "Overview", exact: true })).toBeVisible();
      await expect(page.locator("body")).toContainText("THE 5·9 WIRE · BEAT ASSIGNED");
      await expect(page.locator("body")).toContainText("The first scan is underway");
      await expect(page.getByText("The first scan is running now")).toHaveCount(0);
      await expect(page.locator(".f9-first-run-spine").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Watch more competitors", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "View plans", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Add another", exact: true })).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(/stakeout|under watch|on camera|surveillance/i);
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);

      // Wait beat on /app/watchlists: the run is genuinely running, so "reading
      // now" is truthful here — the one place the active-reading line is allowed.
      await page.goto("/app/watchlists?watchlist=e2e-watchlist-firstscan");
      await expect(page.getByRole("heading", { level: 1, name: "Competitors", exact: true })).toBeVisible();
      await expect(page.locator(".f9-wire-wait")).toBeVisible();
      await expect(page.locator("body")).toContainText("ON THE WIRE");
      await expect(page.locator("body")).toContainText("GOING TO PRESS");
      await expect(page.locator("body")).toContainText("Reading Rival Labs now");
      await expect(page.locator("body")).not.toContainText(/stakeout|under watch|on camera|surveillance/i);
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j3-first-run-wait", state: "first-run-wait" });
      annotateFinalUrl(testInfo, page);
    });
  }

  for (const viewport of monitoringViewports) {
    test(`WP-C2 Beat 4 front page files once with weekly cadence truth at ${viewport.width}px`, async ({ page, context, baseURL }, testInfo) => {
      annotateScenario(testInfo, "first-brief-front-page-and-cadence");
      testInfo.annotations.push({ type: "persona", description: "e2e-free-firstbrief,e2e-scout" });
      testInfo.annotations.push({ type: "viewport", description: `${viewport.width}x${viewport.height}` });
      await signInAs(context, baseURL!, "e2e-free-firstbrief");
      await page.setViewportSize(viewport);

      // Overview: the first brief has filed -> the spine retires and the bridge
      // hands the user to their front-page brief with the arc-arrival flag.
      await page.goto("/app");
      await expect(page.getByRole("heading", { level: 1, name: "Overview", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Your first brief is ready.", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Read the full brief →", exact: true })).toHaveAttribute(
        "href",
        "/app/digests?firstrun=1",
      );
      await expect(page.locator(".f9-first-run-spine")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);

      // Beat 4 front page (arrived from the arc): real filed time, a FUNCTIONAL
      // same-page anchor CTA, and NO daily 05:09 promise for a weekly plan.
      await page.goto("/app/digests?firstrun=1");
      await expect(page.getByRole("heading", { level: 1, name: "Briefs", exact: true })).toBeVisible();
      await expect(page.locator("body")).toContainText("FIRST BRIEF · FILED");
      await expect(page.locator("body")).toContainText("Your first brief on Rival Labs is");
      await expect(page.getByRole("link", { name: "Read the full brief →", exact: true })).toHaveAttribute(
        "href",
        "#first-brief-detail",
      );
      await expect(page.locator("#first-brief-detail")).toBeVisible();
      await expect(page.locator("body")).not.toContainText("05:09");
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);
      // Capture the release artifact on the genuine front-page state.
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j3-first-brief", state: "first-brief-front-page" });

      // Retirement: ordinary Briefs navigation (no arc flag) shows the standard
      // master-detail page, never the front-page framing again.
      await page.goto("/app/digests");
      await expect(page.getByRole("heading", { level: 1, name: "Briefs", exact: true })).toBeVisible();
      await expect(page.locator("body")).not.toContainText("FIRST BRIEF · FILED");
      await expect(page.getByRole("heading", { name: "Brief history", exact: true })).toBeVisible();

      // Scout is weekly too — its Briefs surface never promises the daily 05:09.
      await signInAs(context, baseURL!, "e2e-scout");
      await page.goto("/app/digests?firstrun=1");
      await expect(page.getByRole("heading", { level: 1, name: "Briefs", exact: true })).toBeVisible();
      await expect(page.locator("body")).not.toContainText("05:09");
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);
      annotateFinalUrl(testInfo, page);
    });
  }
});
