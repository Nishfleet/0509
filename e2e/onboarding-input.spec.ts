import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// Screen 1 of the onboarding flow (parent #3996, slice #4417): the mono step
// bar and the one input, and the input is the only way into the card. Any
// non-empty value redirects untouched, including nonsense — the "nothing found"
// line for nonsense belongs to the card screen (#3993). Production only — the
// preview lane's wrangler dev has no EMAIL binding and no inbox to read, so
// this spec skips there rather than fake the sign-in.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "screen 1 needs a signed-in session; the preview lane cannot read the magic-link inbox",
);

test("the one input posts and redirects every non-empty value to the card", async ({ page }) => {
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;

  await signInWithMagicLink(page, email, token);

  const input = page.getByRole("textbox", { name: "your website, or a handle" });

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/onboarding");
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await expect(page.getByRole("navigation", { name: "Onboarding progress" })).toBeVisible();
    await expect(input).toBeFocused();

    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noHorizontalScroll).toBe(true);

    await input.press("Enter");
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("status")).toContainText(
      "find anything for that, try the main website",
    );
    await expect(input).toBeFocused();

    // `/onboarding/identity` is a 404 until #3993 lands, so its noise would
    // land in this array; the emptiness proof is taken before the redirects.
    expect(consoleErrors).toEqual([]);
    page.removeAllListeners("console");

    for (const value of ["nike.com", "@nike", "qzxv wplk 9981"]) {
      await page.goto("/onboarding");
      await input.fill(value);
      await input.press("Enter");
      const expected = `/onboarding/identity?subject=${encodeURIComponent(value)}`;
      await expect(page).toHaveURL((url) => url.pathname + url.search === expected);
    }
  }
});
