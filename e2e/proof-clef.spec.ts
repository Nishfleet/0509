import { test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

const BRAND = process.env.PROOF_BRAND ?? "allbirds.com";
const READ_MS = Number(process.env.PROOF_READ_MS ?? "0");

test("clef proof: one sign-up, one brand", async ({ page }) => {
  test.setTimeout(240_000);
  const token = requireInboxToken();
  const email = process.env.PROOF_EMAIL ?? "";
  console.log(`CLEF ACCOUNT ${email} brand=${BRAND} startedAt=${new Date().toISOString()}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInWithMagicLink(page, email, token);
  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.waitFor();
  await input.fill(BRAND);
  const enterAt = Date.now();
  await input.press("Enter");
  const outcome = await Promise.race([
    page.getByRole("button", { name: "edit name" }).waitFor({ timeout: 60_000 }).then(() => "card"),
    page.getByText(/couldn't check that just now/i).waitFor({ timeout: 60_000 }).then(() => "unavailable"),
    page.getByText(/business or a public creator/i).waitFor({ timeout: 60_000 }).then(() => "asks-person-or-business"),
  ]);
  const cardAt = Date.now();
  console.log(`CLEF BRAND-STEP outcome=${outcome} ms=${cardAt - enterAt}`);
  if (outcome !== "card") throw new Error(`brand step ended in ${outcome}`);
  await page.getByText("looking on the site").waitFor({ state: "detached", timeout: 60_000 });
  await page.waitForTimeout(READ_MS);
  const confirmAt = Date.now();
  await page.getByRole("button", { name: "That's me" }).click();
  await page.waitForURL(/\/onboarding\/competitors$/, { timeout: 20_000 });
  const listed = page
    .getByRole("list", { name: "Watching" })
    .getByRole("listitem")
    .or(page.getByRole("list", { name: "Possible competitors" }).getByRole("listitem"));
  await listed.first().waitFor({ timeout: 120_000 });
  const listAt = Date.now();
  console.log(`CLEF TIMING brand=${BRAND} read_ms=${READ_MS} enter_to_card_ms=${cardAt - enterAt} card_to_list_ms=${listAt - cardAt} confirm_to_list_ms=${listAt - confirmAt}`);
  let names = await listed.allInnerTexts();
  const settleDeadline = Date.now() + 60_000;
  let stableSince = Date.now();
  while (Date.now() < settleDeadline && Date.now() - stableSince < 10_000) {
    await page.waitForTimeout(1000);
    const next = await listed.allInnerTexts();
    if (next.length !== names.length) stableSince = Date.now();
    names = next;
  }
  console.log(`CLEF SETTLED brand=${BRAND} settle_ms=${Date.now() - listAt}`);
  console.log(`CLEF RIVALS brand=${BRAND} count=${names.length} ${JSON.stringify(names.map((n) => n.replace(/\s+/g, " ").slice(0, 80)))}`);
});
