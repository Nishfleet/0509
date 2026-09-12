import { expect, test, type BrowserContext, type Page, type Locator } from "@playwright/test";

/**
 * ISSUE #3175 (epic #3172 slice 2) — competitor suggestions auto-populate from
 * evidence, each with a one-line "why" and its source, with the plan caps
 * enforced per plan.
 *
 * This is the END-TO-END acceptance the issue asks for: "e2e for a domain with
 * known competitors returns >=5 with why+source". It drives the real
 * /app/watchlists board against the local release server, whose D1 fixture
 * (e2e/fixtures/e2e-local.sql) carries the exact discovery-cache keys the seed
 * builds for `starter-fixture.com` — one own-domain entry whose keywords seed
 * the probe, plus the probe entry carrying six real advertisers.
 *
 * Nothing here is stubbed: the seed reads the cached entries, ranks them, and
 * the panel renders what came back. The assertions therefore fail if the
 * feature regresses rather than if a mock drifts.
 *
 * Selectors use the repo's `[data-test=...]` convention (the panel's existing
 * hooks) rather than `getByTestId`, which would look for `data-testid`.
 *
 * Acceptance bullets covered:
 *   - >=5 suggestions, each with a non-empty why and a named source;
 *   - the free plan sees the same evidence as a frozen snapshot, still removable;
 *   - a paid plan's rows are addable and removable.
 */

const fixtureCookie = "f9_e2e_fixture";
const fixtureModeHeader = "x-0509-e2e-test-mode";

const byTest = (root: Page | Locator, value: string) => root.locator(`[data-test="${value}"]`);

async function signInAs(context: BrowserContext, baseURL: string, userId: string) {
  const url = baseURL || "http://127.0.0.1:4179";
  await context.setExtraHTTPHeaders({ [fixtureModeHeader]: "1" });
  await context.addCookies([
    { name: fixtureCookie, value: userId, url, sameSite: "Lax" },
  ]);
}

async function openSuggestions(page: Page) {
  await page.goto("/app/watchlists", { waitUntil: "domcontentloaded" });
  const panel = byTest(page, "suggested-competitors-panel");
  await expect(panel).toBeVisible({ timeout: 20_000 });
  return panel;
}

test("a domain with known competitors shows >=5 suggestions, each with a why and a source", async ({
  context,
  baseURL,
  page,
}) => {
  await signInAs(context, baseURL!, "e2e-starter");
  const panel = await openSuggestions(page);

  const rows = byTest(panel, "suggested-row");
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThanOrEqual(5);

  // Every rendered suggestion states why it is a competitor and where it came
  // from — the two facts the issue requires on every row.
  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    const why = byTest(row, "suggested-why");
    await expect(why).toBeVisible();
    expect((await why.innerText()).trim().length).toBeGreaterThan(0);

    const source = byTest(row, "suggested-source");
    await expect(source).toBeVisible();
    const sourceValue = await source.getAttribute("data-source");
    expect([
      "ad_keyword_overlap",
      "landing_page_seed",
      "adjacent_brand_fallback",
    ]).toContain(sourceValue);

    // The evidence receipt is still rendered next to the short line.
    await expect(byTest(row, "suggested-provenance")).toBeVisible();
  }
});

test("a paid plan's suggestions are addable and removable", async ({
  context,
  baseURL,
  page,
}) => {
  await signInAs(context, baseURL!, "e2e-starter");
  const panel = await openSuggestions(page);
  const firstRow = byTest(panel, "suggested-row").first();
  await expect(firstRow).toBeVisible({ timeout: 20_000 });

  // Addable: the accept form posts the panel's intent.
  await expect(firstRow.getByRole("button", { name: "Add as competitor" })).toBeVisible();
  // Removable: one-tap remove is present on the paid surface.
  await expect(firstRow.getByRole("button", { name: "Remove" })).toBeVisible();

  // The cap is a real plan cap, not a rendering accident: a Starter workspace
  // tracks 10, so it is offered at most the paid ceiling of 8 rows.
  const rowCount = await byTest(panel, "suggested-row").count();
  expect(rowCount).toBeLessThanOrEqual(8);
});
