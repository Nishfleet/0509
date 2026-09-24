import { expect, test } from "@playwright/test";

// The homepage, staged at /design/landing behind the staff gate until launch;
// / keeps the static rebuild notice (Nish, 2026-09-24). What is asserted is the
// contract: section order, one headline, the priced action and where it goes,
// the structured data matching the visible page. Copy stays unpinned.

const PATH = "/design/landing";

test("the landing renders its sections in order under one headline", async ({ page }) => {
  const response = await page.goto(PATH);
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const order = await page.locator("main > section").evaluateAll((sections) => sections.map((section) => section.id));
  expect(order).toEqual(["hero", "mark", "how-it-works", "what-we-watch", "agents", "price", "faq"]);
});

test("the landing's action names its price and leads to sign-in", async ({ page }) => {
  await page.goto(PATH);
  const start = page.locator("#hero").getByRole("link", { name: /€\d+\/mo/ });
  await expect(start).toBeVisible();
  await expect(start).toHaveAttribute("href", "/login");
  await expect(page.locator("#price").getByRole("link", { name: /€\d+\/mo/ })).toHaveAttribute("href", "/login");
});

test("the landing carries its search metadata and structured data", async ({ page }) => {
  await page.goto(PATH);
  await expect(page).toHaveTitle(/\S/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /^.{50,160}$/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://0509.io/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/og\.png$/);
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

  const scripts = page.locator('script[type="application/ld+json"]');
  await expect(scripts).toHaveCount(1);
  const graph = JSON.parse((await scripts.textContent()) ?? "") as {
    "@graph": { "@type": string; offers?: unknown[]; mainEntity?: { name: string }[] }[];
  };
  expect(graph["@graph"].map((node) => node["@type"])).toEqual([
    "Organization",
    "WebSite",
    "SoftwareApplication",
    "FAQPage",
  ]);
  expect(graph["@graph"][2]?.offers).toHaveLength(3);

  const visible = await page.locator("#faq h3").allTextContents();
  expect(graph["@graph"][3]?.mainEntity?.map((question) => question.name)).toEqual(visible);
});

test("the landing does not scroll horizontally", async ({ page }) => {
  await page.goto(PATH);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("the social preview image is served", async ({ request }) => {
  const response = await request.get("/og.png");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
});

test("the organization logo is served", async ({ request }) => {
  const response = await request.get("/logo.svg");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"].startsWith("image/svg+xml")).toBe(true);
});
