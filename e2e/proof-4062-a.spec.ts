import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

test.setTimeout(300_000);

export async function readSettings(page: Page) {
  await page.goto("/app/settings");
  const day = Number(await page.getByLabel("Day").inputValue());
  const hour = Number(await page.getByLabel("Time").inputValue());
  const text = (await page.getByText(/Time zone:.*Next\s+brief:/).first().innerText()).replace(/\s+/g, " ");
  const timezone = /Time zone: (.+?)\. Next brief: (.+)\.$/.exec(text);
  return {
    day,
    hour,
    timezone: (timezone?.[1] ?? "").replaceAll(" ", "_"),
    nextLine: timezone?.[2] ?? text,
    at: new Date().toISOString(),
  };
}

test("proof 4062 phase A: fresh account, onboard, first brief-day change", async ({ page, context }) => {
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  mkdirSync("e2e/.auth", { recursive: true });
  await signInWithMagicLink(page, email, requireInboxToken());
  await context.storageState({ path: "e2e/.auth/proof-session.json" });
  writeFileSync("e2e/.auth/proof.email", email);

  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.fill("gymshark.com");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 10_000 });
  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  await expect(
    watching.first().or(page.getByRole("button", { name: /^Watch / }).first()).first(),
  ).toBeVisible({ timeout: 60_000 });
  if ((await watching.count()) === 0) {
    await page.getByRole("button", { name: /^Watch / }).first().click();
    await expect(watching.first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
  await context.storageState({ path: "e2e/.auth/proof-session.json" });

  const before = await readSettings(page);
  const day1 = (before.day + 2) % 7;
  const saved = page.waitForResponse((r) => r.url().includes("/app/settings") && r.request().method() === "POST");
  await page.getByLabel("Day").selectOption(String(day1));
  console.log("change1 POST status", (await saved).status());
  await expect.poll(async () => (await readSettings(page)).day).toBe(day1);
  const after1 = await readSettings(page);
  const evidence = { email, before, after1 };
  writeFileSync("e2e/.auth/proof.json", JSON.stringify(evidence, null, 2));
  console.log("PROOF_A " + JSON.stringify(evidence));
});
