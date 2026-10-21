import { type Page } from "@playwright/test";
import { expect, test } from "./test";

import { FIXTURE_ACCOUNTS } from "../app/lib/fixture-accounts";
import {
  consoleFailures,
  isLocalLane,
  requireInboxToken,
  seedPreviewSession,
  signInWithMagicLink,
  watchConsole,
} from "./inbox";

async function seedSession(): Promise<string> {
  const { cookie } = await seedPreviewSession("j6-keyboard", ({ db, suffix, userId }) => {
    const stamp = "2026-09-27T00:00:00.000Z";
    db.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    ).run(`ws-${suffix}`, "Keyboard", userId, stamp);
    db.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
    ).run(`ent-self-${suffix}`, `ws-${suffix}`, `self-${suffix}.example`, stamp);
    db.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'competitor', ?, 'Zephyrwear', ?)",
    ).run(`ent-${suffix}`, `ws-${suffix}`, `zephyr-${suffix}.example`, stamp);
  });
  return cookie;
}

async function onboard(page: Page): Promise<void> {
  await page.goto("/onboarding");
  if (!new URL(page.url()).pathname.startsWith("/onboarding/competitors")) {
    const input = page.getByRole("textbox", { name: /your website address or social username/i });
    await input.fill("gymshark.com");
    await input.press("Enter");
    await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
    await page.getByRole("button", { name: "Looks right" }).click();
    await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 10_000 });
  }
  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  if ((await watching.count()) === 0) {
    await page.locator("#add-competitor").fill("nike.com");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(watching.first()).toBeVisible({ timeout: 30_000 });
  }
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
}

async function watchOneCompetitor(page: Page, projectName: string): Promise<void> {
  const account = projectName === "phone-390" ? FIXTURE_ACCOUNTS.j6Phone : FIXTURE_ACCOUNTS.j6Desktop;
  await signInWithMagicLink(page, account.email, requireInboxToken(), /\/(app|onboarding)/);
  if (new URL(page.url()).pathname.startsWith("/onboarding")) await onboard(page);

  await page.goto("/app/competitors");
  const on = page.getByRole("switch", { name: / tracking/, checked: true });
  if ((await on.count()) > 0) return;
  const first = page.getByRole("switch", { name: / tracking/ }).first();
  if ((await first.count()) > 0) {
    await first.click();
  } else {
    await page.locator("#add-competitor").fill("nike.com");
    await page.getByRole("button", { name: "Add", exact: true }).click();
  }
  await expect(on.first()).toBeVisible({ timeout: 30_000 });
}

test("the per-brand switch is operable with a keyboard alone @own-signin", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const watched = watchConsole(page);

  if (!isLocalLane()) {
    await watchOneCompetitor(page, testInfo.project.name);
  } else {
    await page.setExtraHTTPHeaders({ cookie: await seedSession() });

    const response = await page.goto("/app/alerts");
    expect(response?.status()).toBe(200);
  }

  await page.reload();
  const nav = page.getByRole("navigation", { name: "Primary" });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(nav.getByRole("link", { name: "Home" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(nav.getByRole("link", { name: "Competitors" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/competitors$/);
  await expect(page.getByRole("heading", { level: 1, name: "Competitors" })).toBeVisible();

  await page.reload();
  const order: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""));
  }
  expect(order).toEqual(["Skip to content", "Home", "Competitors", "Brief", "Alerts", "Settings"]);
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("page.viewportSize() returned null");
  const width = viewport.width;
  console.log(`focus-order[width=${String(width)}] ${order.join(" -> ")}`);

  if (width < 860) {
    const navBox = await nav.boundingBox();
    if (navBox === null) throw new Error("the Places nav has no box at phone width");
    expect(await nav.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    expect(Math.abs(navBox.y + navBox.height - viewport.height)).toBeLessThanOrEqual(2);
  }

  const toggle = page.getByRole("switch", { name: / tracking (ON|OFF)$/ }).first();
  for (let i = 0; i < 60; i += 1) {
    if (await toggle.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  const noteId = await toggle.getAttribute("aria-describedby");
  expect(noteId).toBeTruthy();
  const note = page.locator(`[id="${noteId ?? ""}"]`);
  await expect(note).toContainText("Turn off to stop watching and alerts");

  await page.keyboard.press("Space");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("[data-slot='brand-switch-field']").first()).toHaveAttribute("data-state", "off");
  await expect(note).toContainText(/Paused .*history kept/);
  console.log(
    `switch[width=${String(width)}] aria-checked=true->false, note="${(await note.textContent())?.trim() ?? ""}"`,
  );

  await page.keyboard.press("Space");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(note).toContainText("Turn off to stop watching and alerts");
  console.log(
    `switch[width=${String(width)}] aria-checked=false->true, note="${(await note.textContent())?.trim() ?? ""}"`,
  );

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
