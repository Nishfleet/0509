import { expect, test } from "@playwright/test";

// The shared public footer (0509#4080). Every public page that renders in this
// tree carries the same three things: privacy, terms, and the takedown address
// in plain text. The standing card is not in this list: its artifact is
// streamed verbatim from R2 and has no renderer in this tree yet.

const PUBLIC_ROUTES = ["/", "/login", "/privacy", "/terms"] as const;

for (const path of PUBLIC_ROUTES) {
  test(`the footer on ${path} carries privacy, terms, and the takedown address`, async ({
    page,
  }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);

    const footer = page.locator("footer");
    await expect(footer.locator('a[href="/privacy"]')).toBeVisible();
    await expect(footer.locator('a[href="/terms"]')).toBeVisible();
    const takedown = footer.locator('a[href="mailto:support@0509.io"]');
    await expect(takedown).toBeVisible();
    await expect(takedown).toContainText("support@0509.io");
    await expect(footer).not.toContainText("!");
  });
}

test("the terms page states conduct and removal, and makes no unbacked retention claim", async ({
  page,
}) => {
  const response = await page.goto("/terms");
  expect(response?.status()).toBe(200);

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeEmpty();

  const main = page.locator("main");
  await expect(main).toContainText(/private individual/i);
  await expect(main).toContainText(/minors/i);
  await expect(main).toContainText(/degraded/i);
  await expect(main).toContainText(/robots\.txt/i);
  await expect(main).toContainText(/logged-out/i);
  await expect(main).toContainText(/paid data provider/i);
  await expect(main).toContainText(/72 hours/i);
  await expect(main).toContainText(/takedown row/i);
  await expect(main).not.toContainText(/30 days/i);
  await expect(main).not.toContainText(/90 days/i);
  await expect(main).not.toContainText(/365/);
  await expect(main).not.toContainText(/!/);
});
