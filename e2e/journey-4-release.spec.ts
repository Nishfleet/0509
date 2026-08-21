import {
  expect,
  installReleaseHydrationBridge,
  test,
  type BrowserContext,
  type Page,
} from "./helpers/release-test";
import { requireExactReleaseBaseURL } from "./helpers/release-origin";
import { attachReleaseStateArtifacts } from "./helpers/release-artifacts";
import {
  expectNoHorizontalOverflow,
  expectPhoneTouchTargets,
  expectVisibleKeyboardFocus,
  focusAdvanceKey,
} from "./helpers/release-experience";

const fixtureCookie = "f9_e2e_fixture";
const fixtureModeHeader = "x-0509-e2e-test-mode";

async function signInAs(
  context: BrowserContext,
  baseURL: string,
  userId: string,
) {
  const url = requireExactReleaseBaseURL(baseURL);
  await context.setExtraHTTPHeaders({ [fixtureModeHeader]: "1" });
  await context.addCookies([
    { name: fixtureCookie, value: userId, url, sameSite: "Lax" },
  ]);
}

type J4ReplayAction =
  | "report-share"
  | "client-room"
  | "batch-failure"
  | "approval-stale";

async function runJ4Replay(
  page: Page,
  viewport: { width: number; height: number },
  action: J4ReplayAction,
) {
  const viewportKey = `${viewport.width}x${viewport.height}`;
  const idempotencyKey = `e2e-j4-${action}-${viewportKey}`;
  const runId = `e2e-run-j4-${action}-${viewportKey}`;
  const requestBody = {
    userId: "e2e-agency",
    runId,
    idempotencyKey,
    scenario: "j4",
    clock: new Date().toISOString(),
  };
  const first = await page.request.post("/api/e2e/j4/replay", {
    headers: { [fixtureModeHeader]: "1" },
    data: requestBody,
  });
  expect(first.status(), `${action} replay must complete`).toBe(200);
  const firstBody = await first.json() as Record<string, unknown>;
  expect(firstBody).toMatchObject({ ok: true, replayed: false });

  const repeated = await page.request.post("/api/e2e/j4/replay", {
    headers: { [fixtureModeHeader]: "1" },
    data: requestBody,
  });
  expect(repeated.status(), `${action} replay retry must complete`).toBe(200);
  const repeatedBody = await repeated.json() as Record<string, unknown>;
  expect(repeatedBody).toMatchObject({ ok: true, replayed: true });
  expect({ ...repeatedBody, replayed: false }).toEqual(firstBody);

  const stateResponse = await page.request.get(
    `/api/e2e/j4/replay?idempotencyKey=${idempotencyKey}&runId=${runId}`,
    { headers: { [fixtureModeHeader]: "1" } },
  );
  expect(stateResponse.status(), `${action} durable state must be readable`).toBe(200);
  const state = await stateResponse.json() as Record<string, unknown>;
  expect(Object.keys(state).sort()).toEqual([
    "action",
    "effects",
    "idempotencyKey",
    "ok",
    "provider",
    "replayStatus",
    "runId",
  ]);
  expect(state).toMatchObject({
    ok: true,
    action: action.replaceAll("-", "_"),
    idempotencyKey,
    runId,
    replayStatus: "succeeded",
    provider: { called: false, reason: "e2e_network_denied" },
  });
  const serialized = JSON.stringify(state);
  expect(serialized).not.toContain("processingToken");
  expect(serialized).not.toContain("processing_token");
  expect(serialized).not.toContain("result_json");
  expect(serialized).not.toContain("shareUrl");
  expect(serialized).not.toContain('"token"');

  const effects = state.effects as Record<string, unknown>;
  expect(Object.keys(effects).sort()).toEqual([
    "activeShareCount",
    ...(action === "approval-stale" ? ["approvalInvalidated"] : []),
    "auditAction",
    "auditCount",
    "auditResourceId",
    "auditResourceType",
    "auditStatus",
    "requestFingerprintPresent",
    "resultPresent",
    "roomCount",
    "roomResourceCount",
    "shareCount",
  ].sort());
  return { firstBody, state, effects };
}

async function expectNoOverflow(page: Page) {
  await expectNoHorizontalOverflow(page);
}

async function expectTouchTargets(page: Page) {
  await expectPhoneTouchTargets(page);
  const undersized = await page
    .locator("button, a.f9-wk-btn, a.f9-wk-btn-quiet, a.f9-evidence-cta")
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (!element.checkVisibility() || rect.width === 0 || rect.height === 0) {
          return [];
        }
        return rect.width >= 44 && rect.height >= 44
          ? []
          : [
              {
                text: (element.textContent ?? "").trim(),
                width: rect.width,
                height: rect.height,
              },
            ];
      }),
    );
  expect(
    undersized,
    "interactive controls should retain a 44px touch target",
  ).toEqual([]);
}

async function expectLiveRegion(page: Page, message: string) {
  // Prefer `.f9-action-feedback` so empty layout `role=status` nodes cannot
  // steal a `.last()` match under concurrent paint. Fall back to any live
  // region for pages that surface the same copy without that class.
  const region = page
    .locator(".f9-action-feedback")
    .filter({ hasText: message })
    .or(
      page
        .locator('[role="status"], [role="alert"]')
        .filter({ hasText: message }),
    )
    .first();
  // The share/report intents round-trip through a server action before the
  // feedback region renders; on the shared vps-verify runner that can exceed
  // 15s under fleet load (run 32471530295, 768px share flake) even though the
  // region persists once rendered. 30s matches the local-release per-test
  // budget philosophy in playwright.config.ts; the assertion itself is
  // unchanged and retries stay 0.
  await expect(region).toBeVisible({ timeout: 30_000 });
  await expect(region).toHaveAttribute("aria-live", /^(polite|assertive)$/);
}

/**
 * Wait until the share button is idle after a document POST so a still-running
 * revalidation cannot rewrite controlled fingerprint fields under the next
 * mutation (Gate-B journey-4 stale-share flake).
 */
async function expectShareSubmitIdle(
  page: Page,
  form: ReturnType<Page["locator"]>,
) {
  const sendButton = form.getByRole("button", { name: "Send to client" });
  await expect(sendButton).toBeEnabled();
  await expect(sendButton).not.toHaveAttribute("aria-busy", "true");
  await expect
    .poll(async () => {
      const busy = await sendButton.getAttribute("aria-busy");
      return busy === "true" ? "busy" : "idle";
    })
    .toBe("idle");
}

/**
 * Set a deliberate stale fingerprint and submit in one evaluate so a late
 * React re-render cannot restore the loader fingerprint between write and
 * click.
 */
async function submitShareWithStaleFingerprint(
  form: ReturnType<Page["locator"]>,
) {
  await form.evaluate((node) => {
    const shareForm = node as HTMLFormElement;
    const fingerprint = shareForm.querySelector(
      'input[name="reviewFingerprint"]',
    ) as HTMLInputElement | null;
    if (!fingerprint) {
      throw new Error("share form is missing reviewFingerprint");
    }
    fingerprint.value = "stale";
    if (typeof shareForm.requestSubmit === "function") {
      shareForm.requestSubmit();
      return;
    }
    shareForm.submit();
  });
}

async function expectKeyboardFocus(page: Page) {
  const browserName = page.context().browser()?.browserType().name();
  await page.keyboard.press(focusAdvanceKey(browserName));
  const control = page.locator(":focus");
  await expect(control).toBeVisible();
  await expectVisibleKeyboardFocus(control);
}

// BL-009: source coverage moved into the report's "05 — how this was checked"
// fact rail, and rows became numbered evidence plates (brief §6.6, §6.9). The
// claim under test is unchanged: the report must index at least one current
// verified-evidence artifact.
async function expectCurrentEvidenceArtifactIndex(page: Page) {
  const method = page.locator("#report-05");
  await expect(method).toBeVisible();
  const verifiedEvidence = method
    .locator(".f9-evidence-fact-row")
    .filter({ hasText: "Verified evidence" })
    .locator(".f9-evidence-fact-value");
  await expect(verifiedEvidence).toHaveText(/^\d+$/u);
  expect(
    Number(await verifiedEvidence.textContent()),
    "the current report must index at least one verified evidence artifact",
  ).toBeGreaterThan(0);
  const plates = page.locator(
    'section[aria-label="Report evidence plates"] .f9-evidence-plate',
  );
  expect(
    await plates.count(),
    "the report artifact index must contain a current evidence plate",
  ).toBeGreaterThan(0);
  await expect(plates.first()).toBeVisible();
}

async function expectReportAtViewport(
  page: Page,
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await page.goto("/app/reports/watchlist:e2e-watchlist-agency-1");
  await expect(
    page.getByText("Approved evidence report", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole("heading", { name: "Landing page offer changed" })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("Verified evidence", { exact: true }).first(),
  ).toBeVisible();
  // The fixture stores these values on proof_capture (legacy field keys),
  // not on the linked ad. Report loading must join that evidence instead of
  // emitting the unreadable empty-plate state.
  await expect(
    page.getByText("New AI workflow launch", { exact: true }).first(),
  ).toBeVisible();
  await expectCurrentEvidenceArtifactIndex(page);
  await expect(
    page.getByRole("button", { name: "Send to client" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download PDF" }),
  ).toBeVisible();
  await expectKeyboardFocus(page);
  await expectTouchTargets(page);
  await expectNoOverflow(page);
}

function annotateScenario(
  testInfo: { annotations: Array<{ type: string; description?: string }> },
  scenario: string,
) {
  testInfo.annotations.push({ type: "scenario", description: scenario });
}

function annotateFinalUrl(
  testInfo: { annotations: Array<{ type: string; description?: string }> },
  page: Page,
) {
  const url = new URL(page.url());
  testInfo.annotations.push({
    type: "finalUrl",
    description: `${url.pathname}${url.search}`,
  });
}

const reportViewports = [
  { width: 375, height: 812 },
  { width: 768, height: 900 },
  { width: 1440, height: 900 },
] as const;

test.describe("Gate-B Journey 4 — evidence, reports, sharing, export, and client delivery", () => {
  for (const viewport of reportViewports) {
    test(`agency evidence report is client-readable and keyboard reachable at ${viewport.width}px`, async ({
      page,
      context,
      baseURL,
    }, testInfo) => {
      annotateScenario(testInfo, "report-proof-freshness-client-readable");
      testInfo.annotations.push({ type: "persona", description: "e2e-agency" });
      testInfo.annotations.push({
        type: "viewport",
        description: `${viewport.width}x${viewport.height}`,
      });
      await signInAs(context, baseURL!, "e2e-agency");
      const shareReplay = await runJ4Replay(page, viewport, "report-share");
      expect(shareReplay.effects).toMatchObject({
        auditCount: 1,
        auditStatus: "succeeded",
        auditAction: "report.share",
        auditResourceType: "report",
        auditResourceId: "watchlist:e2e-watchlist-agency-1",
        requestFingerprintPresent: true,
        resultPresent: true,
        shareCount: 1,
        activeShareCount: 1,
        roomCount: 0,
        roomResourceCount: 0,
      });
      const batchFailure = await runJ4Replay(page, viewport, "batch-failure");
      expect(batchFailure.effects).toMatchObject({
        auditCount: 1,
        auditStatus: "failed",
        auditAction: "share.create",
        auditResourceType: null,
        auditResourceId: null,
        requestFingerprintPresent: true,
        resultPresent: false,
        shareCount: 0,
        activeShareCount: 0,
        roomCount: 0,
        roomResourceCount: 0,
      });
      await expectReportAtViewport(page, viewport);
      // BL-009: source coverage is no longer a mid-report packet — it is the
      // report's closing "05 — how this was checked" section. Same guarantee,
      // stated where a client reads it: what was included, what was filtered
      // out, and the sentence that refuses to estimate.
      const method = page.locator("#report-05");
      await expect(method).toContainText("How this was checked");
      // The proof mix is the method rail, not the glossary that closes the
      // section — both legitimately use these labels.
      const methodRail = method.locator(".f9-evidence-fact-rail");
      await expect(methodRail.getByText("Verified evidence", { exact: true })).toBeVisible();
      await expect(methodRail.getByText("Check-spotted", { exact: true })).toBeVisible();
      await expect(methodRail.getByText("Needs review", { exact: true })).toBeVisible();
      await expect(methodRail.getByText("Excluded", { exact: true })).toBeVisible();
      await expect(method).toContainText("verified-evidence event included");
      await expect(method).toContainText(
        "Where a number was not published by the source, this report says so rather than estimating it.",
      );
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j4-report", state: "report-proof" });
      annotateFinalUrl(testInfo, page);
    });
  }

  for (const viewport of reportViewports) {
    test(`exports and share controls expose plan truth before click and do not claim provider delivery at ${viewport.width}px`, async ({
      page,
      context,
      browser,
      baseURL,
    }, testInfo) => {
    annotateScenario(testInfo, "export-share-plan-truth");
    testInfo.annotations.push({
      type: "persona",
      description: "e2e-agency;e2e-starter",
    });
    testInfo.annotations.push({ type: "viewport", description: `${viewport.width}x${viewport.height}` });
    await signInAs(context, baseURL!, "e2e-agency");
    await page.setViewportSize(viewport);
    await page.goto(
      "/app/watchlists?watchlist=e2e-watchlist-agency-1&tab=evidence",
    );
    await expect(
      page.getByRole("link", { name: "Export CSV" }),
    ).toHaveAttribute("href", "/export/watchlist/e2e-watchlist-agency-1");
    await expect(
      page.getByRole("link", { name: "Export JSON" }),
    ).toHaveAttribute(
      "href",
      "/export/watchlist/e2e-watchlist-agency-1?format=json",
    );
    const csvResponse = await page.request.get(
      "/export/watchlist/e2e-watchlist-agency-1",
      { headers: { [fixtureModeHeader]: "1" } },
    );
    expect(
      csvResponse.status(),
      "CSV export should be an executable local surface",
    ).toBe(200);
    expect(csvResponse.headers()["content-disposition"] ?? "").toMatch(
      /attachment/i,
    );
    const jsonResponse = await page.request.get(
      "/export/watchlist/e2e-watchlist-agency-1?format=json",
      { headers: { [fixtureModeHeader]: "1" } },
    );
    expect(
      jsonResponse.status(),
      "JSON export should be an executable local surface",
    ).toBe(200);
    expect(jsonResponse.headers()["content-type"] ?? "").toMatch(/json/i);
    // BL-035: client handoff is attached to stored evidence. The Evidence tab
    // keeps the completed-check report destination alongside share/export.
    await expect(
      page.getByRole("link", { name: "Package for client" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Share summary" }),
    ).toBeVisible();
    // BL-036: report eligibility belongs to a completed Agency check, not to
    // whether that check happened to catch a change. This fixture has a
    // succeeded run and unchanged before/after captures, with no watch event.
    await page.goto("/app/watchlists?watchlist=e2e-watchlist-agency-quiet");
    const quietPane = page.locator(".f9-watchdetail-detail");
    await expect(page.locator(".f9-wk-context")).toContainText("Quiet");
    await expect(
      quietPane.getByRole("link", { name: "Package for client" }),
    ).toHaveAttribute(
      "href",
      "/app/reports/watchlist:e2e-watchlist-agency-quiet",
    );
    await page.goto(
      "/app/watchlists?watchlist=e2e-watchlist-agency-quiet&tab=evidence",
    );
    await expect(page.getByRole("button", { name: "Share summary" })).toBeVisible();
    const reportPage = await page.request.get(
      "/app/reports/watchlist:e2e-watchlist-agency-1",
      { headers: { [fixtureModeHeader]: "1" } },
    );
    expect(
      reportPage.status(),
      "the agency report route should be readable",
    ).toBe(200);
    await page.goto("/app/reports/watchlist:e2e-watchlist-agency-1");
    const shareForm = page.locator("form").filter({
      has: page.locator('input[name="intent"][value="share-report"]'),
    });
    const pdfForm = page.locator("form").filter({
      has: page.locator('input[name="intent"][value="download-pdf"]'),
    });
    await expect(pdfForm).toHaveCount(1);
    // BL-009: ONE reviewed-state control for the page, not one floating
    // checkbox per form. It stays a real field of the share form (so the
    // browser enforces the attestation without JavaScript) and the PDF
    // submission mirrors its state into a hidden field.
    const reviewControl = page.locator('input[type="checkbox"][name="reviewed"]');
    await expect(reviewControl).toHaveCount(1);
    await expect(reviewControl).toHaveAttribute("required", "");
    await expect(reviewControl).toHaveAttribute("value", "true");
    await expect(reviewControl).toHaveAttribute("form", "report-share-form");
    await expect(reviewControl).not.toBeChecked();
    const pdfReview = pdfForm.locator('input[type="hidden"][name="reviewed"]');
    await expect(pdfReview).toHaveValue("false");
    const pdfButton = pdfForm.getByRole("button", { name: "Download PDF" });
    await expect(pdfButton).toBeDisabled();

    await reviewControl.evaluate((control) => control.removeAttribute("required"));
    await shareForm.getByRole("button", { name: "Send to client" }).click();
    await expectLiveRegion(
      page,
      "Review the current evidence before sharing or downloading this report.",
    );
    // Stabilise after the validation-only failure: the reports route must not
    // rotate fingerprint/nonce under a customer mid-recovery, and the button
    // must leave its pending state before the next deliberate mutation.
    await expectShareSubmitIdle(page, shareForm);

    const staleShareForm = page.locator("form").filter({
      has: page.locator('input[name="intent"][value="share-report"]'),
    });
    await page.locator('input[type="checkbox"][name="reviewed"]').check();
    await expect(pdfForm.locator('input[type="hidden"][name="reviewed"]')).toHaveValue(
      "true",
    );
    await expect(pdfButton).toBeEnabled();
    // Atomic stale write + submit: separate evaluate-then-click left a window
    // where loader revalidation rewrote the controlled fingerprint field and
    // the second submit published successfully (no review_stale live region).
    await submitShareWithStaleFingerprint(staleShareForm);
    await expectLiveRegion(
      page,
      "The report changed after you opened it. Review the current evidence before sharing or downloading.",
    );
    await expectShareSubmitIdle(page, staleShareForm);
    // Guard against the accidental-success path that used to flake this gate.
    await expect(
      page
        .locator(".f9-action-feedback")
        .filter({ hasText: "Snapshot link created." }),
    ).toHaveCount(0);

    await page.reload();
    const currentPdfForm = page.locator("form").filter({
      has: page.locator('input[name="intent"][value="download-pdf"]'),
    });
    const reviewFingerprint = await currentPdfForm
      .locator('input[name="reviewFingerprint"]')
      .inputValue();
    const reviewNonce = await currentPdfForm
      .locator('input[name="reviewNonce"]')
      .inputValue();

    const pdfPublication = await page.request.post(page.url(), {
      headers: { [fixtureModeHeader]: "1" },
      form: {
        intent: "download-pdf",
        reviewed: "true",
        reviewFingerprint,
        reviewNonce,
      },
      maxRedirects: 0,
    });
    expect(pdfPublication.status()).toBe(303);
    const pdfLocation = pdfPublication.headers().location ?? "";
    expect(pdfLocation).toMatch(/^\/share\/[a-z0-9]+\/pdf$/u);
    const pdfProviderProof = await page.request.get(pdfLocation, {
      headers: { [fixtureModeHeader]: "1" },
    });
    expect(pdfProviderProof.status()).toBe(503);
    expect(await pdfProviderProof.json()).toMatchObject({
      error: "pdf_unconfigured",
    });
    await expectNoOverflow(page);

    const starterContext = await browser.newContext({ baseURL });
    try {
      await signInAs(starterContext, baseURL!, "e2e-starter");
      const starterPage = await starterContext.newPage();
      installReleaseHydrationBridge(starterPage, testInfo);
      await starterPage.setViewportSize(viewport);
      await starterPage.goto("/app/reports/watchlist:e2e-watchlist-starter-1");
      await expect(
        starterPage.getByRole("heading", {
          level: 1,
          name: "Client-ready reports",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        starterPage.getByText(
          "Open client-ready reports and share the evidence with your team — included in the Agency plan.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        starterPage.getByRole("link", { name: "Upgrade to Agency" }),
      ).toBeVisible();
      await expect(
        starterPage.getByRole("button", { name: "Send to client" }),
      ).toHaveCount(0);
      await expect(
        starterPage.getByRole("button", { name: "Download PDF" }),
      ).toHaveCount(0);
      await expect(
        starterPage.getByText("PDF export is unavailable for this workspace.", {
          exact: false,
        }),
      ).toHaveCount(0);
      await expectTouchTargets(starterPage);
      await expectNoOverflow(starterPage);
    } finally {
      await starterContext.close();
    }
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j4-export", state: "export-share-gate" });
    annotateFinalUrl(testInfo, page);
    });
  }

  for (const viewport of reportViewports) {
    test(`client rooms make empty and gated delivery states explicit before room creation at ${viewport.width}px`, async ({
      page,
      context,
      browser,
      baseURL,
    }, testInfo) => {
    annotateScenario(testInfo, "client-room-empty-gated-delivery");
    testInfo.annotations.push({
      type: "persona",
      description: "e2e-agency;e2e-starter",
    });
    testInfo.annotations.push({ type: "viewport", description: `${viewport.width}x${viewport.height}` });
    await signInAs(context, baseURL!, "e2e-agency");
    await page.setViewportSize(viewport);
    await page.goto("/app/clients");
    await expect(
      page.getByRole("heading", { name: "Client rooms", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create client room" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No client rooms yet" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create client room" }).click();
    await expect(
      page.getByRole("heading", { name: "Bundle evidence and notes" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save client room" }),
    ).toBeVisible();
    await expectTouchTargets(page);
    await expectNoOverflow(page);

    const starterContext = await browser.newContext({ baseURL });
    try {
      await signInAs(starterContext, baseURL!, "e2e-starter");
      const starterPage = await starterContext.newPage();
      installReleaseHydrationBridge(starterPage, testInfo);
      await starterPage.setViewportSize(viewport);
      await starterPage.goto("/app/clients");
      await expect(
        starterPage.getByRole("heading", {
          level: 1,
          name: "Client rooms",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        starterPage.getByRole("heading", { name: "Client rooms stay readable" }),
      ).toBeVisible();
      await expect(
        starterPage.getByRole("link", { name: "Upgrade to Agency" }),
      ).toBeVisible();
      await expect(
        starterPage.getByText("Existing rooms remain available below", {
          exact: false,
        }),
      ).toBeVisible();
      await expect(
        starterPage.getByRole("button", { name: "Save client room" }),
      ).toHaveCount(0);
      await expect(
        starterPage.getByRole("heading", { name: "No existing client rooms" }),
      ).toBeVisible();
      await expectTouchTargets(starterPage);
      await expectNoOverflow(starterPage);
    } finally {
      await starterContext.close();
    }
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j4-clients", state: "empty-gated-room" });
    annotateFinalUrl(testInfo, page);
    });
  }

  for (const viewport of reportViewports) {
    test(`reviewed report share opens anonymously, revokes immediately, and can be re-reviewed into a new link at ${viewport.width}px`, async ({
      page,
      context,
      browser,
      baseURL,
    }, testInfo) => {
    annotateScenario(testInfo, "review-share-anonymous-open-revoke-re-review");
    testInfo.annotations.push({
      type: "persona",
      description: "e2e-agency;anonymous-client",
    });
    testInfo.annotations.push({ type: "viewport", description: `${viewport.width}x${viewport.height}` });
    await signInAs(context, baseURL!, "e2e-agency");
    await page.setViewportSize(viewport);

    const shareReviewedReport = async () => {
      await page.goto("/app/reports/watchlist:e2e-watchlist-agency-1");
      const shareForm = page.locator("form").filter({
        has: page.locator('input[name="intent"][value="share-report"]'),
      });
      // One reviewed-state control for the page (BL-009); it belongs to the
      // share form via the `form` attribute rather than sitting inside it.
      const reviewedControl = page.locator('input[type="checkbox"][name="reviewed"]');
      await expect(reviewedControl).toHaveCount(1);
      await expect(reviewedControl).toHaveAttribute("required", "");
      await expect(reviewedControl).toHaveAttribute("value", "true");
      await expect(reviewedControl).not.toBeChecked();
      await reviewedControl.check();
      await shareForm.getByRole("button", { name: "Send to client" }).click();
      await expectLiveRegion(page, "Snapshot link created.");
      const shareAnchor = page.locator('a[href*="/share/"]').last();
      await expect(shareAnchor).toBeVisible();
      const href = await shareAnchor.getAttribute("href");
      expect(
        href,
        "the reviewed share action should expose a public URL",
      ).toMatch(/^https?:\/\/[^/]+\/share\//);
      return href as string;
    };

    const anonymousContext = await browser.newContext({
      baseURL,
      extraHTTPHeaders: { [fixtureModeHeader]: "1" },
    });
    const anonymousPage = await anonymousContext.newPage();
    installReleaseHydrationBridge(anonymousPage, testInfo);
    try {
      await anonymousPage.setViewportSize(viewport);
      const firstShareUrl = await shareReviewedReport();
      const firstOpenResponse = await anonymousPage.goto(firstShareUrl);
      expect(
        firstOpenResponse?.status(),
        "an anonymous client should be able to open the approved snapshot",
      ).toBe(200);
      await expect(
        anonymousPage.locator(".f9-evidence-report-kicker"),
      ).toContainText("Competitor evidence report");
      // BL-009: the finding is no longer a row heading inside the snapshot —
      // it IS the shared document's headline (brief §6.10). Asserting level 1
      // is the stronger form of the same guarantee: an anonymous client sees
      // what we caught before anything else.
      await expect(
        anonymousPage.getByRole("heading", {
          name: "Landing page offer changed",
          level: 1,
        }),
      ).toBeVisible();
      await expectTouchTargets(anonymousPage);
      await expectNoOverflow(anonymousPage);
      await expectKeyboardFocus(anonymousPage);

      const concurrentOwnerPage = await context.newPage();
      installReleaseHydrationBridge(concurrentOwnerPage, testInfo);
      await concurrentOwnerPage.setViewportSize(viewport);
      await Promise.all([
        page.goto("/app/shares"),
        concurrentOwnerPage.goto("/app/shares"),
      ]);
      const shareRowFor = (ownerPage: Page) => ownerPage
        .locator(".f9-wk-row")
        .filter({ hasText: firstShareUrl });
      const firstShareRow = shareRowFor(page);
      const concurrentShareRow = shareRowFor(concurrentOwnerPage);
      await Promise.all([
        expect(firstShareRow).toContainText("Report · Snapshot"),
        expect(concurrentShareRow).toContainText("Report · Snapshot"),
        expect(firstShareRow).toContainText("Approved"),
        expect(concurrentShareRow).toContainText("Approved"),
      ]);
      const armRevoke = async (ownerPage: Page) => {
        const revokeButton = shareRowFor(ownerPage).getByRole("button", {
          name: "Revoke",
        });
        await revokeButton.click();
        const confirmButton = shareRowFor(ownerPage).getByRole("button", {
          name: "Confirm — revoke link?",
        });
        await expect(confirmButton).toBeVisible();
        return confirmButton;
      };
      const [firstConfirm, concurrentConfirm] = await Promise.all([
        armRevoke(page),
        armRevoke(concurrentOwnerPage),
      ]);
      await Promise.all([firstConfirm.click(), concurrentConfirm.click()]);
      const feedbackText = async (ownerPage: Page) => {
        const feedback = ownerPage.locator(".f9-wk-strip p");
        await expect(feedback).toBeVisible();
        return (await feedback.innerText()).trim();
      };
      const revokeMessages = await Promise.all([
        feedbackText(page),
        feedbackText(concurrentOwnerPage),
      ]);
      expect(revokeMessages.sort()).toEqual([
        "Share link not found — it may already be revoked.",
        "Share link revoked. The URL stops working immediately.",
      ].sort());
      await Promise.all([page.reload(), concurrentOwnerPage.reload()]);
      await expect(
        page.locator(".f9-wk-row").filter({ hasText: firstShareUrl }),
      ).toHaveCount(0);
      await expect(
        concurrentOwnerPage.locator(".f9-wk-row").filter({ hasText: firstShareUrl }),
      ).toHaveCount(0);
      await concurrentOwnerPage.close();
      const revokedResponse = await anonymousPage.goto(firstShareUrl);
      expect(
        revokedResponse?.status(),
        "revocation should deny the old public URL",
      ).toBe(404);

      const secondShareUrl = await shareReviewedReport();
      expect(secondShareUrl, "re-review should mint a new bearer URL").not.toBe(
        firstShareUrl,
      );
      const secondOpenResponse = await anonymousPage.goto(secondShareUrl);
      expect(
        secondOpenResponse?.status(),
        "the replacement approved snapshot should open anonymously",
      ).toBe(200);
      await expect(
        anonymousPage.locator(".f9-evidence-report-kicker"),
      ).toContainText("Competitor evidence report");
      await expectTouchTargets(anonymousPage);
      await expectNoOverflow(anonymousPage);
      await expectKeyboardFocus(anonymousPage);
      await page.goto("/app/shares");
      const replacementRow = page.locator(".f9-wk-row").filter({ hasText: secondShareUrl });
      await expect(replacementRow).toContainText("Report · Snapshot");
      await expect(replacementRow).toContainText("Approved");
      await attachReleaseStateArtifacts({ page, testInfo, prefix: "j4-share", state: "share-revoke-rereview" });
      annotateFinalUrl(testInfo, page);
    } finally {
      await anonymousContext.close();
    }
    });
  }

  for (const viewport of reportViewports) {
    test(`client-room delivery stays gated until current evidence is approved, then recovers to ready at ${viewport.width}px`, async ({
      page,
      context,
      baseURL,
    }, testInfo) => {
    annotateScenario(testInfo, "client-room-approval-recovery");
    testInfo.annotations.push({ type: "persona", description: "e2e-agency" });
    testInfo.annotations.push({ type: "viewport", description: `${viewport.width}x${viewport.height}` });
    await signInAs(context, baseURL!, "e2e-agency");
    await page.setViewportSize(viewport);
    const roomReplay = await runJ4Replay(page, viewport, "client-room");
    const roomId = String(
      (roomReplay.firstBody.room as { id?: unknown } | undefined)?.id ?? "",
    );
    expect(roomId).toMatch(/^[a-zA-Z0-9_-]{8,128}$/u);
    expect(roomReplay.effects).toMatchObject({
      auditCount: 1,
      auditStatus: "succeeded",
      auditAction: "client_room.upsert",
      auditResourceType: "client_room",
      auditResourceId: roomId,
      requestFingerprintPresent: true,
      resultPresent: true,
      shareCount: 0,
      activeShareCount: 0,
      roomCount: 1,
      roomResourceCount: 2,
    });
    await page.goto("/app/clients");

    const roomName = `E2E approval recovery room ${viewport.width}x${viewport.height}`;
    const roomCard = page
      .locator(".f9-client-room-card")
      .filter({ hasText: roomName });
    await expect(roomCard).toContainText("Needs setup before client review");
    await expect(roomCard).toContainText(
      "Review and approve the current report evidence before sending.",
    );
    const approveButton = roomCard.getByRole("button", {
      name: "Review and approve evidence",
    });
    await approveButton.click();
    await expectLiveRegion(
      page,
      "Current report evidence approved for client review.",
    );
    await expect(roomCard).toContainText("Ready for client review");
    await page.reload();
    await expect(roomCard).toContainText("Ready for client review");

    const staleApproval = await runJ4Replay(page, viewport, "approval-stale");
    expect(staleApproval.effects).toMatchObject({
      auditCount: 0,
      auditStatus: null,
      auditAction: null,
      auditResourceType: null,
      auditResourceId: null,
      requestFingerprintPresent: false,
      resultPresent: true,
      shareCount: 0,
      activeShareCount: 0,
      roomCount: 1,
      roomResourceCount: 2,
      approvalInvalidated: true,
    });
    await page.reload();
    await expect(roomCard).toContainText("Needs setup before client review");
    await expect(roomCard).toContainText(
      "Review and approve the current report evidence before sending.",
    );
    await expectTouchTargets(page);
    await expectNoOverflow(page);
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j4-room", state: "approval-recovery" });
    annotateFinalUrl(testInfo, page);
    });
  }

  for (const viewport of reportViewports) {
    test(`missing report recovers to the verified report without pretending that PDF/provider delivery passed at ${viewport.width}px`, async ({
      page,
      context,
      baseURL,
    }, testInfo) => {
    annotateScenario(testInfo, "missing-report-recovery");
    testInfo.annotations.push({ type: "persona", description: "e2e-agency" });
    testInfo.annotations.push({ type: "viewport", description: `${viewport.width}x${viewport.height}` });
    await signInAs(context, baseURL!, "e2e-agency");
    await page.setViewportSize(viewport);
    await page.goto("/app/reports/watchlist:missing-fixture");
    await expect(page.getByRole("alert")).toContainText("Not found");
    await expect(page.getByRole("alert")).toContainText("This page or item is no longer available.");
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Contact support" }),
    ).toBeVisible();
    await expectNoOverflow(page);

    await page.goto("/app/reports/watchlist:e2e-watchlist-agency-1");
    await expect(
      page.getByText("Approved evidence report", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Verified evidence", { exact: true }).first(),
    ).toBeVisible();
    await expectNoOverflow(page);
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j4-missing", state: "missing-recovery" });
    annotateFinalUrl(testInfo, page);
    });
  }
});
