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
        "Workflow acceptance watch",
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
        "Crash reclaim watch",
        [/Scanning this competitor now/, /(first scan is running|First capture running|Your first scan is running)/i],
      );
      // BL-007: run history lives on the Evidence tab.
      await page.goto("/app/watchlists?watchlist=e2e-watchlist-j3-crash&tab=evidence");
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
      // BL-007: the opened competitor is five URL-addressable surfaces
      // (What changed · Evidence · Creative · Delivery · Setup), so each
      // promise is now checked at the URL a customer would actually be on.
      // Page-level status — the state stamp, last/next check and ad source —
      // stays on the strip above the tab bar and is checked on every tab.
      await expectResponsiveSurface(page, viewport, "/app/watchlists?watchlist=e2e-watchlist-starter-1", "Okara competitor watch", [
        /Okara competitor watch/,
        /What changed/,
        /confirmed/i,
      ]);

      // BL-030: the list row states the competitor's state in one sentence,
      // so the promise is checked on the row rather than on its name link.
      await page.goto("/app/watchlists");
      await expect(
        page.locator(".f9-wk-row", { hasText: "Workflow acceptance watch" }).first(),
      ).toContainText("No completed check yet");
      await expect(
        page.locator(".f9-wk-row", { hasText: "Crash reclaim watch" }).first(),
      ).toContainText("No completed check yet");
      await page.goto("/app/watchlists?watchlist=e2e-watchlist-starter-1");
      const sourceAccessStatus = page.getByRole("link", {
        name: "Needs source access",
        exact: true,
      });
      await expect(sourceAccessStatus).toBeVisible();
      await expect(sourceAccessStatus).toHaveAttribute("href", "/app/source-access");
      await expect(page.getByRole("heading", { name: "Landing page offer changed" }).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Okara launched a new workflow offer" }).first()).toBeVisible();
      await expect(page.getByText("This is the stored capture, not a re-render.", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("No alert sent for this change yet.", { exact: true }).first()).toBeVisible();
      await expect(
        page.getByText(
          "Checked. We recorded a new ad. There is no stored before-and-after field to show.",
          { exact: true },
        ).first(),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Suppressed. This low-signal change is not shown as a before-and-after.",
          { exact: true },
        ).first(),
      ).toBeVisible();
      await expect(page.getByText("Fixture confirmed proof-backed offer change.", { exact: true }).first()).toBeVisible();

      await expectResponsiveSurface(
        page,
        viewport,
        "/app/watchlists?watchlist=e2e-watchlist-starter-1&tab=evidence",
        "Okara competitor watch",
        [/Evidence and alerts/, /Evidence freshness/],
      );
      await expect(page.getByText("Last good check", { exact: false })).toBeVisible();
      await expect(page.getByText("Confidence pending", { exact: false }).first()).toBeVisible();
      await expect(page.getByText(/Checked\./).first()).toBeVisible();
      await expect(page.getByText(/Check failed — This scan failed\. Check Source access/).first()).toBeVisible();
      await expect(page.getByText(/1 ads seen/)).toBeVisible();

      await expectResponsiveSurface(
        page,
        viewport,
        "/app/watchlists?watchlist=e2e-watchlist-starter-1&tab=delivery",
        "Okara competitor watch",
        [/High-priority alerts/],
      );
      await expect(page.getByText("High-priority alerts (sent as soon as a scan confirms a major change)")).toBeVisible();
      await expect(page.getByRole("checkbox", { name: /High-priority alerts/ })).toBeChecked();

      await expectResponsiveSurface(
        page,
        viewport,
        "/app/watchlists?watchlist=e2e-watchlist-starter-1&tab=setup",
        "Okara competitor watch",
        [/How tracking works/],
      );
      await expect(page.getByText("Monitoring history is saved; new checks need source access", { exact: true })).toBeVisible();

      // The release artifact is captured on the default surface a customer
      // lands on from an alert email.
      await page.goto("/app/watchlists?watchlist=e2e-watchlist-starter-1");
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
        /Landing page offer changed/,
        /Email delivery unconfirmed/,
      ]);
      await expect(page.getByText("proof", { exact: false }).first()).toBeVisible();
      await expect(page.getByText("Delivery unconfirmed", { exact: true })).toBeVisible();
      await expect(page.getByText("No sends recorded yet", { exact: true })).toBeVisible();
      await expect(page.getByText("Configured email recipient", { exact: true })).toBeVisible();

      await expectResponsiveSurface(page, viewport, "/app/notifications", "Notifications", [
        /Delivery channel/,
        /Email/,
        /Ready/,
        // #705 addition: Slack and Microsoft Teams incoming webhooks are live
        // delivery channels for Starter and Agency plans. Email stays the
        // always-on baseline, so the operator line still names it; WhatsApp
        // delivery stays dormant and must not surface anywhere.
        /Webhook delivery/,
        /Delivery channel: email/,
      ]);
      // Every delivery channel announces itself the same way — a name, a
      // status, and the one next step — so the definition list a screen reader
      // walks carries exactly the truth the page shows.
      const deliveryChannels = page.getByRole("region", { name: "Delivery channel", exact: true });
      await expect(deliveryChannels.getByText("Email", { exact: true })).toBeVisible();
      await expect(deliveryChannels.getByText("Ready", { exact: true })).toBeVisible();
      await expect(
        deliveryChannels.getByText("Briefs go to the account email.", { exact: true }),
      ).toBeVisible();
      await expect(deliveryChannels.getByText("Slack", { exact: true })).toBeVisible();
      await expect(
        deliveryChannels.getByText("Connect a Slack incoming webhook below.", { exact: true }),
      ).toBeVisible();
      await expect(deliveryChannels.getByText("Teams", { exact: true })).toBeVisible();
      await expect(
        deliveryChannels.getByText("Connect a Teams incoming webhook below.", { exact: true }),
      ).toBeVisible();
      // Not-connected is stated, never implied: this persona has connected no
      // webhook, so neither Slack nor Teams may read as a working channel.
      await expect(deliveryChannels.getByText("Not connected", { exact: true })).toHaveCount(2);

      // Source truth for webhook delivery: the exact provider hosts a customer
      // pastes from, and the confirmed-versus-possible line that stops an alert
      // overclaiming what a scan actually proved.
      const webhookDelivery = page.getByRole("region", { name: "Webhook delivery", exact: true });
      await expect(
        webhookDelivery.getByRole("heading", { name: "Slack webhook", exact: true }),
      ).toBeVisible();
      await expect(
        webhookDelivery.getByRole("heading", { name: "Teams webhook", exact: true }),
      ).toBeVisible();
      await expect(webhookDelivery).toContainText("hooks.slack.com");
      await expect(webhookDelivery).toContainText("webhook.office.com");
      await expect(webhookDelivery).toContainText(
        "Unconfirmed changes are always labelled as possible, never as confirmed.",
      );
      // Both connect forms stay reachable by accessible name, not by position.
      await expect(webhookDelivery.getByRole("textbox", { name: "Webhook URL", exact: true })).toHaveCount(2);
      await expect(
        webhookDelivery.getByRole("textbox", { name: "Destination name", exact: true }),
      ).toHaveCount(2);
      await expect(webhookDelivery.getByRole("button", { name: "Connect", exact: true })).toHaveCount(2);
      await expect(page.locator("#f9-main-content")).not.toContainText("WhatsApp");
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
      await expect(page.getByRole("list", { name: "Brief history", exact: true })).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Your first brief lands after the first scan", exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText("Briefs are included in paid plans")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);

      await page.goto("/app/watchlists");
      // BL-030 round 2: an empty board explains itself in a sentence and hands
      // over the page's one filled action, which is the header's quick-add
      // button. The guarantee is unchanged — a customer with nothing tracked
      // is told what happens next and given one way in.
      await expect(
        page.getByText("Add your first competitor and its first check starts immediately.", {
          exact: false,
        }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Add competitor", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "See a sample brief" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);

      await signInAs(context, baseURL!, "e2e-scout");
      // BL-007: the delivery gate lives on the Delivery tab.
      await page.goto("/app/watchlists?watchlist=e2e-watchlist-scout-1&tab=delivery");
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
      await expect(
        page.getByText("Add your first competitor and its first check starts immediately.", {
          exact: false,
        }),
      ).toBeVisible();

      await signInAs(context, baseURL!, "e2e-starter");
      await page.goto("/app/watchlists?watchlist=e2e-watchlist-starter-1");
      await expect(page.getByRole("heading", { name: "Landing page offer changed" }).first()).toBeVisible();
      await expect(page.getByText("This is the stored capture, not a re-render.", { exact: true }).first()).toBeVisible();
      await expect(
        page.getByText(
          "Checked. We recorded a new ad. There is no stored before-and-after field to show.",
          { exact: true },
        ).first(),
      ).toBeVisible();
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
      // BL-007: delivery config and recipient targets live on the Delivery tab.
      await expectResponsiveSurface(page, viewport, "/app/watchlists?watchlist=e2e-watchlist-agency-1&tab=delivery", "Agency client proof watch", [
        /Agency client proof watch/,
        /Targets and pauses/,
      ]);
      await expect(page.locator('input[name="targetValue"]')).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Save delivery settings", exact: true })).toHaveCount(1);

      await signInAs(context, baseURL!, "e2e-active-member");
      await page.goto("/app/watchlists?watchlist=e2e-watchlist-agency-1&tab=delivery");
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Agency client proof watch",
          exact: true,
        }),
      ).toBeVisible();
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
    test(`setup checklist and first-scan banner keep Free activation honest at ${viewport.width}px`, async ({ page, context, baseURL }, testInfo) => {
      annotateScenario(testInfo, "first-run-wait-arc-and-free-capacity");
      testInfo.annotations.push({ type: "persona", description: "e2e-free-firstscan" });
      testInfo.annotations.push({ type: "viewport", description: `${viewport.width}x${viewport.height}` });
      await signInAs(context, baseURL!, "e2e-free-firstscan");
      await page.setViewportSize(viewport);

      // Overview uses the one persistent setup pattern. It must not introduce
      // a second progress spine or claim that a queued scan is already running.
      await page.goto("/app");
      await expect(page.locator("#f9-main-content").getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("#setup-checklist")).toBeVisible();
      await expect(page.locator("#setup-checklist")).toContainText("First evidence");
      await expect(page.getByText("The first scan is running now")).toHaveCount(0);
      await expect(page.locator(".f9-first-run-spine")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Add another", exact: true })).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(/stakeout|under watch|on camera|surveillance/i);
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);

      // Competitors keeps the existing run-backed first-scan banner.
      await page.goto("/app/watchlists?watchlist=e2e-watchlist-firstscan");
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Rival Labs first scan",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator("body")).toContainText("Activation scan");
      await expect(page.locator("body")).toContainText("Your activation scan is running.");
      await expect(page.locator(".f9-wire-wait")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(/stakeout|under watch|on camera|surveillance/i);
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j3-first-run-wait", state: "first-run-wait" });
      annotateFinalUrl(testInfo, page);
    });
  }

  for (const viewport of monitoringViewports) {
    test(`first filed brief opens as the one designed brief at ${viewport.width}px`, async ({ page, context, baseURL }, testInfo) => {
      annotateScenario(testInfo, "first-brief-front-page-and-cadence");
      testInfo.annotations.push({ type: "persona", description: "e2e-free-firstbrief,e2e-scout" });
      testInfo.annotations.push({ type: "viewport", description: `${viewport.width}x${viewport.height}` });
      await signInAs(context, baseURL!, "e2e-free-firstbrief");
      await page.setViewportSize(viewport);

      // A filed brief retires the old first-run spine. Any genuinely incomplete
      // setup checks remain in the one persistent checklist.
      await page.goto("/app");
      await expect(page.locator("#f9-main-content").getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("#setup-checklist")).toBeVisible();
      await expect(page.locator(".f9-first-run-spine")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);

      // BL-015: the arc lands directly on the same designed brief used by
      // ordinary navigation. There is no second front-page hero above it.
      await page.getByRole("link", { name: "Read latest brief", exact: true }).click();
      await expect(page).toHaveURL("/app/digests?firstrun=1");
      await expect(page.getByRole("heading", { level: 1, name: "Briefs", exact: true })).toBeVisible();
      await expect(page.locator(".f9-wk-brief")).toHaveCount(1);
      await expect(
        page.getByRole("heading", { name: "Rival Labs launched a new offer", exact: true }),
      ).toBeVisible();
      await expect(page.locator("#first-brief-detail")).toBeVisible();
      await expect(page.locator("body")).not.toContainText("FIRST BRIEF · FILED");
      await expect(page.locator("body")).not.toContainText("05:09");
      await expectNoHorizontalOverflow(page);
      await expectPhoneTouchTargets(page);
      // Capture the release artifact on the genuine front-page state.
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j3-first-brief", state: "first-brief-front-page" });

      // Ordinary navigation resolves to the same document — one route, one
      // artifact, with no arrival-dependent duplicate.
      await page.goto("/app/digests");
      await expect(page.getByRole("heading", { level: 1, name: "Briefs", exact: true })).toBeVisible();
      await expect(page.locator("body")).not.toContainText("FIRST BRIEF · FILED");
      await expect(page.getByRole("heading", { name: "Brief history", exact: true })).toBeVisible();
      await expect(page.locator(".f9-wk-brief")).toHaveCount(1);

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
