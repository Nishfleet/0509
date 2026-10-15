import type { DatabaseSync } from "node:sqlite";

import AxeBuilder from "@axe-core/playwright";
import { type Page, type TestInfo } from "@playwright/test";
import { expect, test } from "./test";

import {
  deleteCreatedAccount,
  isLocalLane,
  requireInboxToken,
  run,
  seedPreviewSession,
  signInWithMagicLink,
} from "./inbox";
import { hiddenOverflow, seedBareWorkspace, seedCompetitor, seedWorkspace, signIn } from "./quality";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);
  await deleteCreatedAccount(page, createdEmail);
  createdEmail = "";
});

const STAMP = "2026-10-12T00:00:00.000Z";
const SEEDED_SUBJECT = "nope-a11y-onboarding.example.com";

type Step = "input" | "identity" | "competitors";

function seedStep(db: DatabaseSync, suffix: string, userId: string, step: Step): void {
  if (step === "competitors") {
    const workspaceId = seedWorkspace(db, suffix, userId);
    seedCompetitor(db, suffix, workspaceId);
    run(db, "UPDATE onboarding_run SET watching_started_at = NULL WHERE workspace_id = ?", workspaceId);
    return;
  }
  const workspaceId = seedBareWorkspace(db, suffix, userId);
  run(
    db,
    "INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at) VALUES (?, ?, ?, NULL, NULL, 'public_subject:confirmed', 'example.com', ?)",
    `ud-${suffix}`,
    workspaceId,
    userId,
    STAMP,
  );
}

async function signInAtStep(page: Page, baseURL: string | undefined, step: Step): Promise<void> {
  const { cookie } = await seedPreviewSession(
    `a11y-onboarding-${step}`,
    ({ db, suffix, userId }) => {
      seedStep(db, suffix, userId, step);
    },
    { livePlan: false },
  );
  await page.context().clearCookies();
  await signIn(page, baseURL, cookie);
}

async function newCustomer(page: Page, baseURL: string | undefined, step: Step): Promise<void> {
  if (isLocalLane()) {
    await signInAtStep(page, baseURL, step);
    return;
  }
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;
  await signInWithMagicLink(page, email, requireInboxToken());
}

async function reachIdentity(page: Page, baseURL: string | undefined): Promise<void> {
  await newCustomer(page, baseURL, "identity");
  if (isLocalLane()) {
    await page.goto(`/onboarding/identity?subject=${SEEDED_SUBJECT}`);
    await expect(page.getByRole("button", { name: "That's me" })).toBeVisible({ timeout: 30_000 });
    return;
  }
  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.fill("nike.com");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/onboarding\/identity\?subject=nike\.com$/);
  await expect(page.getByRole("button", { name: "That's me" })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "That's me" })).toBeVisible();
}

function axeScan(page: Page, testInfo: TestInfo) {
  return async (label: string): Promise<void> => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    await testInfo.attach(label, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
    expect(results.violations).toEqual([]);
  };
}

async function scanMatrix(
  page: Page,
  scan: (label: string) => Promise<void>,
  name: string,
  url: string,
): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await scan(`${name}-${colorScheme}-${width}`);
    }
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(url);
  expect(await hiddenOverflow(page), `${name} at 320px wide`).toEqual([]);
}

test("the three onboarding screens pass axe at WCAG 2.2 AA in both themes and at both widths (#4149) @own-signin", async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(180_000);
  const scan = axeScan(page, testInfo);

  await newCustomer(page, baseURL, "input");
  await scanMatrix(page, scan, "onboarding", "/onboarding");

  await reachIdentity(page, baseURL);
  await scanMatrix(page, scan, "identity", page.url());

  if (isLocalLane()) {
    await newCustomer(page, baseURL, "competitors");
    await page.goto("/onboarding/competitors");
  } else {
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "edit name" }).click();
    const name = page.getByRole("textbox", { name: "name" });
    await name.fill("Nike");
    await name.press("Escape");
    await page.getByRole("button", { name: "That's me" }).click();
  }
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 10_000 });
  await scanMatrix(page, scan, "competitors", page.url());
});

test("screen 1 is operable by keyboard in order (#4149) @own-signin", async ({ page, baseURL }) => {
  await newCustomer(page, baseURL, "input");

  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/onboarding");

  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await expect(input).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Continue" })).toBeFocused();

  await page.keyboard.press("Tab");
  const support = page.getByRole("link", { name: "support@0509.io" });
  await expect(support).toBeFocused();
});

test("screen 2 is operable by keyboard in order, with one polite live region (#4149) @own-signin", async ({
  page,
  baseURL,
}, testInfo) => {
  const scan = axeScan(page, testInfo);
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await reachIdentity(page, baseURL);

  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.keyboard.press("Tab");
  const editName = page.getByRole("button", { name: "edit name" });
  await expect(editName).toBeFocused();
  await expect(editName).toHaveCSS("outline-style", "solid");

  await page.keyboard.press("Enter");
  const nameField = page.getByRole("textbox", { name: "name", exact: true });
  await expect(nameField).toBeFocused();
  const popup = page.locator('[data-slot="popover-content"]');
  await expect(popup).toHaveCSS("opacity", "1");
  await expect(popup).not.toHaveAttribute("data-starting-style");
  await scan("identity-editor-open-light-1440");

  await page.keyboard.press("Escape");
  await expect(editName).toBeFocused();
  await expect(nameField).toHaveCount(0);

  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(editName).toBeFocused();
  await expect(nameField).toHaveCount(0);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "edit about" })).toBeFocused();

  const thatsMe = page.getByRole("button", { name: "That's me" });
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press("Tab");
    if (await thatsMe.evaluate((el) => el === document.activeElement)) break;
    expect(await page.evaluate(() => document.activeElement?.getAttribute("type"))).toBe("checkbox");
  }
  await expect(thatsMe).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "support@0509.io" })).toBeFocused();
});
