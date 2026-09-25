import { expect, test } from "@playwright/test";

// The homepage, staged at /design/landing behind the staff gate until launch;
// / keeps the static rebuild notice (Nish, 2026-09-24). What is asserted is the
// contract: section order, one headline, the priced action and where it goes,
// the structured data matching the visible page. Copy stays unpinned.

const PATH = "/design/landing";

test("the landing document paints without a module graph", async ({ page }) => {
  const response = await page.goto(PATH);
  expect(response?.status()).toBe(200);
  const html = (await response?.text()) ?? "";
  const head = html.slice(html.indexOf("<head"), html.indexOf("</head>"));
  expect(head).toContain('rel="stylesheet"');
  expect(head).not.toContain('rel="modulepreload"');
  expect(head).toContain("/fonts/bricolage-hero.woff2");
  expect(head).not.toContain("bricolage-grotesque-latin");
});

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
  const hero = page.locator("#hero");
  await expect(hero.getByRole("button", { name: /€\d+\/mo/ })).toBeVisible();
  await expect(hero.locator("form")).toHaveAttribute("action", "/login");
  await expect(hero.locator("form")).toHaveAttribute("method", "get");
  await expect(page.locator("#price").getByRole("link", { name: /€\d+\/mo/ })).toHaveAttribute("href", "/login");
});

test("the hero's first viewport holds the outcome and the one priced input", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const fullFace: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("bricolage-grotesque-latin")) fullFace.push(request.url());
  });

  await page.goto(PATH);
  await page.waitForLoadState("networkidle");

  const hero = page.locator("#hero");
  const pieces = [
    hero.getByText("For founders, brands and creators"),
    hero.getByRole("heading", { level: 1, name: "Know where you stand. And who’s gaining on you." }),
    hero.getByText(/we name the rivals for you, so you do not have to know them/i),
    hero.getByRole("textbox", { name: "your website, or a handle" }),
    hero.getByRole("button", { name: /€\d+\/mo/ }),
    hero.getByText("One input. Sixty seconds to your first standing."),
  ];
  for (const piece of pieces) {
    await expect(piece).toBeVisible();
    const box = await piece.boundingBox();
    const viewport = page.viewportSize();
    if (box === null || viewport === null) {
      throw new Error(box === null ? "piece has no box" : "viewport is unset");
    }
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  }

  const filled = await page.evaluate(() => {
    const height = window.innerHeight;
    return [...document.querySelectorAll("a.bg-ink, button.bg-ink")].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < height;
    }).length;
  });
  expect(filled).toBe(1);
  expect(consoleErrors).toEqual([]);

  const headlineBox = await hero.getByRole("heading", { level: 1 }).boundingBox();
  const proofBox = await hero.locator("#hero-proof").boundingBox();
  if (headlineBox === null || proofBox === null) {
    throw new Error(headlineBox === null ? "headline has no box" : "proof has no box");
  }
  if (testInfo.project.name === "desktop-1440") {
    expect(proofBox.x).toBeGreaterThan(headlineBox.x + headlineBox.width - 1);
  }
  if (testInfo.project.name === "phone-390") {
    expect(proofBox.y).toBeGreaterThanOrEqual(headlineBox.y + headlineBox.height - 1);
  }

  const styles = await page.evaluate(async () => {
    const hrefs = [...document.querySelectorAll('link[rel="stylesheet"]')].flatMap((node) =>
      node instanceof HTMLLinkElement ? [node.href] : [],
    );
    const texts = await Promise.all(hrefs.map((href) => fetch(href).then((response) => response.text())));
    return texts.join("\n");
  });
  expect(styles).toContain("Bricolage Grotesque");
  expect(styles).toContain("/fonts/bricolage-hero.woff2");
  expect(styles).not.toContain("bricolage-grotesque-latin");
  expect(fullFace).toEqual([]);
  await expect(page.locator('link[rel="preload"][href="/fonts/bricolage-hero.woff2"]')).toHaveCount(1);
  await expect(page.locator('link[rel="modulepreload"]')).toHaveCount(0);

  if (testInfo.project.name === "phone-390") {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  }
});

test("the hero input carries what you typed to sign-in", async ({ page }) => {
  await page.goto(PATH);
  await page.locator("#hero").getByRole("textbox", { name: "your website, or a handle" }).fill("example.com");
  await page.locator("#hero").getByRole("button", { name: /€\d+\/mo/ }).click();
  await expect(page).toHaveURL(/\/login\?subject=example\.com$/);
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
