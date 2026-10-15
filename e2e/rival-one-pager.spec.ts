import { expect, test } from "./test";

import { isLocalLane } from "./inbox";
import { seedRankedHomeSession } from "./ranked-home";

test.skip(
  !isLocalLane(),
  "seeds a ranked workspace in the local preview database and copies from its competitor page; never run against production",
);

for (const colorScheme of ["light", "dark"] as const) {
  test(`the rival page copies a one-pager and fits the screen in ${colorScheme}`, async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.emulateMedia({ colorScheme });
    const cookie = await seedRankedHomeSession(`one-pager-${colorScheme}`);
    await page.setExtraHTTPHeaders({ cookie });

    await page.goto("/app/competitors");
    await page
      .getByRole("link", { name: /Kindred/ })
      .first()
      .click();

    const button = page.getByRole("button", { name: "Copy as a one-pager" });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    await expect(page.getByRole("button", { name: "Save name" })).toBeVisible();

    await button.click();
    await expect(page.getByRole("status").filter({ hasText: "Copied." })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("Kindred (kindred.example)");
    expect(copied).toContain("Recent site changes");
    expect(copied.trimEnd().endsWith("From Five to Nine")).toBe(true);

    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(width.scroll).toBe(width.client);
  });
}
