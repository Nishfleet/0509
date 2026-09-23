import { expect, test } from "@playwright/test";

const SECTION_ORDER = [
  "snapshot",
  "biggest-move",
  "developments",
  "peers",
  "facts",
  "sources",
  "verdict",
] as const;

test("the competitor preview page lays out DESIGN.md §2.5 in order, rail beside at 1440 and stacked at 390, with no horizontal scroll", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const response = await page.goto("/design/competitor");
  expect(response?.status()).toBe(200);

  const order = await page
    .locator("[data-section]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-section")));
  expect(order).toEqual([...SECTION_ORDER]);

  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Kindred" })).toBeVisible();

  const width = page.viewportSize()?.width ?? 0;
  const snapshot = await page.locator("[data-section='snapshot']").boundingBox();
  const developments = await page.locator("[data-section='developments']").boundingBox();
  const rail = await page.locator("[data-slot='competitor-rail']").boundingBox();
  if (width >= 1080) {
    expect(rail?.x).toBeGreaterThan((snapshot?.x ?? 0) + (snapshot?.width ?? 0) - 1);
    const heading = await page
      .getByRole("heading", { level: 1, name: "Kindred" })
      .boundingBox();
    const biggestMove = await page.locator("[data-section='biggest-move']").boundingBox();
    expect(heading?.y).toBeLessThan(900);
    expect(biggestMove?.y).toBeLessThan(900);
  } else {
    expect(rail?.y).toBeGreaterThanOrEqual(
      (developments?.y ?? 0) + (developments?.height ?? 0) - 1,
    );
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  await page.screenshot({ path: test.info().outputPath("competitor-page.png"), fullPage: true });

  expect(errors).toEqual([]);
});
