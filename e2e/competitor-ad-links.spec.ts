import { expect, test } from "@playwright/test";

import { consoleFailures, requireInboxToken, signInWithMagicLink, watchConsole } from "./inbox";

// The two outbound ad-library links on a real competitor page, production
// only: the preview Worker has no EMAIL binding and no inbox to read, so it
// cannot mint a session, and this test skips there rather than fake the
// journey. It runs in the `e2e-production` job after deploy.
test("a competitor header opens that brand's live ads in one click", async ({ page }, testInfo) => {
  test.skip(
    !process.env.PLAYWRIGHT_TEST_BASE_URL,
    "the competitor page needs a real session; the local preview Worker cannot mint one",
  );
  test.setTimeout(150_000);
  const watched = watchConsole(page);

  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, requireInboxToken());

  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: "your website, or a handle" });
  await input.fill("gymshark.com");
  await input.press("Enter");

  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 30_000 });

  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  await expect(
    watching.first().or(page.getByRole("button", { name: /^Watch / }).first()),
  ).toBeVisible({ timeout: 60_000 });
  if ((await watching.count()) === 0) {
    await page.getByRole("button", { name: /^Watch / }).first().click();
    await expect(watching.first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/competitors");
  await page.getByRole("list", { name: "Competitors" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/app\/competitors\/[^/]+$/);

  const brand = ((await page.locator("[data-slot='competitor-header'] h1").textContent()) ?? "").trim();
  const domain = ((await page.locator("[data-slot='competitor-identity'] p").first().textContent()) ?? "").trim();
  expect(brand).not.toBe("");
  expect(domain).not.toBe("");

  const meta = page.getByRole("link", { name: `${brand}'s ads on Meta (opens in a new tab)` });
  const google = page.getByRole("link", { name: `${brand}'s ads on Google (opens in a new tab)` });

  await expect(meta).toBeVisible();
  await expect(google).toBeVisible();
  await expect(meta).toHaveText("Their ads on Meta");
  await expect(google).toHaveText("Their ads on Google");
  await expect(meta).toHaveAttribute("target", "_blank");
  await expect(google).toHaveAttribute("target", "_blank");
  await expect(meta).toHaveAttribute("rel", /noopener/);
  await expect(google).toHaveAttribute("rel", /noopener/);

  const metaHref = await meta.getAttribute("href");
  expect(metaHref).not.toBeNull();
  const metaUrl = new URL(metaHref ?? "");
  expect(metaUrl.hostname).toBe("www.facebook.com");
  expect(metaUrl.pathname).toBe("/ads/library/");
  expect(metaUrl.searchParams.get("search_type")).toBe("keyword_exact_phrase");
  expect(metaUrl.searchParams.get("q")).toBe(`"${brand}"`);

  const googleHref = await google.getAttribute("href");
  expect(googleHref).not.toBeNull();
  const googleUrl = new URL(googleHref ?? "");
  expect(googleUrl.hostname).toBe("adstransparency.google.com");
  expect(googleUrl.searchParams.get("region")).toBe("anywhere");
  expect(googleUrl.searchParams.get("domain")).toBe(domain);

  await page.setViewportSize({ width: 390, height: 844 });
  const links = page.locator("[data-slot='competitor-ad-links']");
  const overflow = await links.evaluate(
    (el) => el.scrollWidth - el.clientWidth + document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await testInfo.attach("competitor-ad-links", {
    body: await links.screenshot(),
    contentType: "image/png",
  });

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
