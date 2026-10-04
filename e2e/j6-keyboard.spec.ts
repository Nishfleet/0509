import { expect, test, type Page } from "@playwright/test";

import {
  consoleFailures,
  deleteCreatedAccount,
  isLocalLane,
  requireInboxToken,
  seedPreviewSession,
  signInWithMagicLink,
  watchConsole,
} from "./inbox";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);
  await deleteCreatedAccount(page, createdEmail);
  createdEmail = "";
});

// J6 by keyboard alone (0509#4158): a customer can turn a competitor off and
// back on without a pointer. From whatever app page the session lands on, the
// contract is `page.keyboard` only: Tab through the Places nav to
// "Competitors", Enter, Tab to the brand's switch, Space off, Space back on.
// The switch's state is announced on change (focus never leaves the control,
// aria-checked flips) and the consequence line is associated through
// aria-describedby.
//
// Two lanes, one contract:
// - production (PLAYWRIGHT_TEST_BASE_URL set, the deployment_status run): a
//   real magic-link sign-in and the J3 onboarding, gymshark.com watched, the
//   same journey competitor-page.spec.ts drives.
// - preview (unset, the PR's own e2e run): the local Worker cannot mint a
//   session, so the spec seeds one in preview D1 the way
//   alerts-chips.spec.ts does — the keyboard contract is identical either way.
//
// The desktop-1440 and phone-390 projects run it at the two widths the issue
// names; at 390 the Places nav is the fixed bottom tab bar.

// One signed-in workspace that already watches one competitor — the smallest
// seed that puts a switch on /app/competitors. The self entity is what counts
// the workspace as past onboarding: without it the /app layout middleware
// (app/lib/require-onboarded.server.ts) redirects every /app page to
// /onboarding before the loader runs.
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

// J3 setup for the production lane — the same journey competitor-page.spec.ts
// drives — because a per-brand switch only exists once the workspace watches a
// competitor.
async function watchOneCompetitor(page: Page): Promise<void> {
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;
  await signInWithMagicLink(page, email, requireInboxToken());

  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.fill("gymshark.com");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 10_000 });

  // The keyboard contract needs one watched rival. Discovery may still be
  // looking (up to 180 s) with no Watch buttons yet; adding one ourselves is
  // the same Add-a-competitor-we-missed path the screen already offers.
  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  const watchBtn = page.getByRole("button", { name: /^Watch / }).first();
  if ((await watching.count()) === 0) {
    if (await watchBtn.isVisible()) {
      await watchBtn.click();
    } else {
      await page.locator("#add-competitor").fill("nike.com");
      await page.getByRole("button", { name: "Add" }).click();
    }
    await expect(watching.first()).toBeVisible({ timeout: 30_000 });
  }
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
}

test("the per-brand switch is operable with a keyboard alone @own-signin", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const watched = watchConsole(page);

  if (!isLocalLane()) {
    await watchOneCompetitor(page);
  } else {
    await page.setExtraHTTPHeaders({ cookie: await seedSession() });
    // Any app page carries the nav; /app/alerts renders on these seeds alone.
    const response = await page.goto("/app/alerts");
    expect(response?.status()).toBe(200);
  }

  // J6 starts here; the pointer is done for the rest of the test. A reload
  // pins the tab count to the top of the document. The skip link is first,
  // then the nav's "Competitors" link is two more Tabs and an Enter away.
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

  // The focus-order contract: from the top of a freshly loaded page the skip
  // link is first, then the four Places. At 390 they are the fixed bottom tab
  // bar — same order, different chrome.
  await page.reload();
  const order: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""));
  }
  expect(order).toEqual(["Skip to content", "Home", "Competitors", "Alerts", "Settings"]);
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

  // Reach the brand's switch by Tab alone. The list holds competitors only, so
  // every "… tracking" switch here is operable; focus lands on the first. The
  // DOM accessible name is the aria-label "<brand> tracking"
  // (app/components/brand-switch.tsx:76), but Playwright's name engine folds
  // the wrapping <label>'s ON/OFF state span in — the error-context snapshot
  // reports `switch "Zephyrwear tracking ON"` — so the match anchors the
  // rendered tail, which is the state text, and still matches after the flip.
  const toggle = page.getByRole("switch", { name: / tracking (ON|OFF)$/ }).first();
  for (let i = 0; i < 60; i += 1) {
    if (await toggle.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  // The consequence line is part of the control: aria-describedby resolves to
  // the printed consequence, so it is read with the switch.
  const noteId = await toggle.getAttribute("aria-describedby");
  expect(noteId).toBeTruthy();
  const note = page.locator(`[id="${noteId ?? ""}"]`);
  await expect(note).toContainText("Turn off to stop watching and alerts");

  // Space turns the brand off. The change is announced because focus stays on
  // the switch and its aria-checked flips; the line it describes now reads
  // paused, and the field's data-state marks the row OFF.
  await page.keyboard.press("Space");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("[data-slot='brand-switch-field']").first()).toHaveAttribute("data-state", "off");
  await expect(note).toContainText(/Paused .*history kept/);
  console.log(
    `switch[width=${String(width)}] aria-checked=true->false, note="${(await note.textContent())?.trim() ?? ""}"`,
  );

  // Space turns it back on; J6 ends with the workspace as it started.
  await page.keyboard.press("Space");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(note).toContainText("Turn off to stop watching and alerts");
  console.log(
    `switch[width=${String(width)}] aria-checked=false->true, note="${(await note.textContent())?.trim() ?? ""}"`,
  );

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
