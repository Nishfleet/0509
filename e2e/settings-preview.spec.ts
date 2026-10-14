import type { DatabaseSync } from "node:sqlite";

import { type Page } from "@playwright/test";
import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";

test.skip(
  !isLocalLane(),
  "the preview Worker signs in through a seeded session; production covers settings in j15-settings-and-brands.spec.ts",
);

test.describe.configure({ mode: "serial" });

function seed({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): void {
  const stamp = "2026-10-12T00:00:00.000Z";
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    `ws-${suffix}`,
    "Settings Preview",
    userId,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
    `ent-self-${suffix}`,
    `ws-${suffix}`,
    `self-${suffix}.example`,
    stamp,
  );
}

async function signIn(page: Page, baseURL: string | undefined): Promise<void> {
  const { cookie } = await seedPreviewSession("settings", seed);
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );
  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
}

test("the brief day saves at once and is still there after a reload", async ({ page, baseURL }) => {
  await signIn(page, baseURL);
  const day = page.getByRole("combobox", { name: "Day", exact: true });
  const before = await day.inputValue();
  const options = await day.locator("option").evaluateAll((all) => all.map((o) => (o as HTMLOptionElement).value));
  const next = options.find((value) => value !== before);
  expect(next).toBeDefined();
  await day.selectOption(next ?? before);
  await expect(page.getByText("Brief time saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Day", exact: true })).toHaveValue(next ?? before);
});

test("pausing the brief says so, survives a reload, and resuming undoes it", async ({ page, baseURL }) => {
  await signIn(page, baseURL);
  await page.getByRole("button", { name: "Pause the brief" }).click();
  await expect(page.getByText(/Paused since/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Paused since/)).toBeVisible();
  await page.getByRole("button", { name: "Resume the brief" }).click();
  await expect(page.getByRole("button", { name: "Pause the brief" })).toBeVisible();
  await expect(page.getByText(/Paused since/)).toHaveCount(0);
});

test("the own-site alerts switch keeps its state across a reload", async ({ page, baseURL }) => {
  await signIn(page, baseURL);
  const control = page.getByRole("switch", { name: /Immediate alerts for your own site/ });
  const was = await control.isChecked();
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/app/settings"),
  );
  await control.click();
  await saved;
  await page.reload();
  await expect(control).toBeChecked({ checked: !was });
});

test("a delivery address that is not an email is stopped and not saved", async ({ page, baseURL }) => {
  await signIn(page, baseURL);
  const field = page.locator("#delivery-address-input");
  const original = await field.inputValue();
  await field.fill("not-an-email");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(await field.evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true);
  await page.reload();
  await expect(page.locator("#delivery-address-input")).toHaveValue(original);
});

test("sign out of all devices ends the session and sends you to sign in", async ({ page, browser, baseURL }) => {
  await signIn(page, baseURL);
  const cookies = await page.context().cookies();
  await page.getByRole("button", { name: "Sign out of all devices" }).click();
  await page.waitForURL(/\/login/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);

  const otherDevice = await browser.newContext({ baseURL });
  await otherDevice.addCookies(cookies);
  const other = await otherDevice.newPage();
  await other.goto("/app/settings");
  await expect(other).toHaveURL(/\/login/);
  await otherDevice.close();
});

test("deleting an account says the plan is cancelled and points to the export first", async ({ page, baseURL }) => {
  await signIn(page, baseURL);
  const section = page.locator("#delete-account").locator("xpath=..");
  await expect(section).toContainText("Your plan is cancelled and the emails stop.");
  await expect(section).toContainText("Use Download my data above.");
});
