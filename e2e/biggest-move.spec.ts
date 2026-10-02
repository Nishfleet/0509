import { expect, test } from "@playwright/test";

import { FIXTURE_ACCOUNTS } from "../app/lib/fixture-accounts";
import { requireInboxToken, signInWithMagicLink } from "./inbox";

test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "the soak workspace lives in production; the preview lane has no inbox to sign in through",
);

test("every watched brand's page leads with its biggest move or the quiet-week sentence @own-signin", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  test.skip(testInfo.project.name === "phone-390", "one sign-in: the desktop lane reads the pages");

  await signInWithMagicLink(page, FIXTURE_ACCOUNTS.soak.email, requireInboxToken(), /\/app/);
  await page.goto("/app/competitors");
  const links = page.getByRole("list", { name: "Competitors", exact: true }).getByRole("link");
  await expect(links.first()).toBeVisible();
  const hrefs = await links.evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThanOrEqual(4);

  const seen = { move: 0, quiet: 0 };
  for (const href of hrefs) {
    await page.goto(href);
    const slab = page.locator("[data-section='biggest-move']");
    await expect(slab).toBeVisible();
    const box = await slab.boundingBox();
    expect(box?.y ?? Infinity).toBeLessThan(900);
    const read = slab.locator("[data-slot='biggest-move-read']");
    const quiet = slab.getByText(/^Nothing worth scoring for this competitor in the last 7 days\./);
    const kind = (await read.count()) === 1 ? "move" : "quiet";
    if (kind === "move") {
      await expect(read).toContainText(/\d+ × \d+ = \d+ points, the most of anything this brand did this week\.$/);
      await expect(quiet).toHaveCount(0);
    } else {
      await expect(quiet).toBeVisible();
    }
    seen[kind] += 1;
    await testInfo.attach(`${href.split("/").pop() ?? "brand"}-${kind}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    console.log(`biggest move ${href}: ${kind}`);
  }
  console.log(`biggest move: ${String(seen.move)} with a move, ${String(seen.quiet)} quiet`);
});
