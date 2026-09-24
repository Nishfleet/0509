import { expect, test } from "@playwright/test";

test("a competitor page sends a signed-out visitor to the login page", async ({ request }) => {
  const response = await request.get("/app/competitors/ent-anything", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers()["location"]).toMatch(/\/login/);
});

test("a change's screenshot is never served to a signed-out visitor", async ({ request }) => {
  for (const side of ["before", "after"]) {
    const response = await request.get(`/app/changes/sig-anything/${side}`, { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers()["location"]).toMatch(/\/login/);
    expect(response.headers()["content-type"] ?? "").not.toContain("image/");
  }
});

test("the preview page leads with the switch and its consequence, and turns off without a dialog", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const response = await page.goto("/design/competitor");
  expect(response?.status()).toBe(200);

  const toggle = page.getByRole("switch", { name: "Kindred tracking" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  const sentence = page.getByText("Off stops the watching and the alerts.", { exact: false });
  await expect(sentence).toBeVisible();

  const first = await page.evaluate(
    () => document.querySelector("[role='switch'], button, select, textarea")?.getAttribute("role"),
  );
  expect(first).toBe("switch");

  const width = page.viewportSize()?.width ?? 0;
  if (width >= 1080) {
    const toggleBox = await toggle.boundingBox();
    const sentenceBox = await sentence.boundingBox();
    expect(toggleBox).not.toBeNull();
    expect(sentenceBox).not.toBeNull();
    expect((toggleBox?.y ?? 0) + (toggleBox?.height ?? 0)).toBeLessThan(900);
    expect(sentenceBox?.y ?? 0).toBeLessThan(900);
  }

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("[data-slot='competitor-paused']")).toContainText("Paused");
  await expect(sentence).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  await testInfo.attach("design-competitor", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  expect(consoleErrors).toEqual([]);
});
