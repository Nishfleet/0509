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
  expect(head).not.toContain('type="module"');
});

test("the landing renders its sections in order under one headline", async ({ page }) => {
  const response = await page.goto(PATH);
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const order = await page.locator("main > section").evaluateAll((sections) => sections.map((section) => section.id));
  expect(order).toEqual(["hero", "mark", "how-it-works", "what-we-watch", "agents", "price", "faq"]);
});

test("how it works reads as three ruled steps in order, wide and narrow", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(PATH);
  await page.waitForLoadState("networkidle");

  const section = page.locator("#how-it-works");
  const steps = section.locator("ol > li");
  await expect(steps).toHaveCount(3);
  const titles = ["Paste your site or handle", "Meet who you’re up against", "Read one email on Monday"];
  for (const [index, title] of titles.entries()) {
    await expect(steps.nth(index).getByRole("heading", { level: 3, name: title })).toBeVisible();
  }
  expect(consoleErrors).toEqual([]);

  if (testInfo.project.name === "desktop-1440") {
    const rows = await steps.evaluateAll((items) =>
      items.map((item) => {
        const rect = item.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }),
    );
    for (const [index, row] of rows.entries()) {
      if (index === 0) continue;
      const previous = rows.at(index - 1);
      if (previous === undefined) throw new Error(`step ${index + 1} has no previous step`);
      expect(row.top).toBeGreaterThanOrEqual(previous.bottom - 1);
    }
  }
  if (testInfo.project.name === "phone-390") {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  }

  await testInfo.attach(`how-it-works-${testInfo.project.name}`, {
    body: await section.screenshot(),
    contentType: "image/png",
  });
});

test("the agents section hands a visitor's agent the MCP address and the API docs", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(PATH);
  await page.waitForLoadState("networkidle");

  const agents = page.locator("#agents");
  await expect(agents.getByText("https://0509.io/mcp")).toBeVisible();
  for (const name of ["Claude", "Cursor", "ChatGPT"]) {
    await expect(agents.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(agents.getByRole("link", { name: "Read the API docs" })).toHaveAttribute(
    "href",
    "/api/v1/openapi.json",
  );
  expect(consoleErrors).toEqual([]);

  await testInfo.attach(`agents-${testInfo.project.name}`, {
    body: await agents.screenshot(),
    contentType: "image/png",
  });
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
    if (request.url().includes("/fonts/")) fullFace.push(request.url());
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
  expect(styles).toContain("Instrument Sans");
  expect(styles).toContain("IBM Plex Mono");
  expect(styles).toContain("/fonts/bricolage-hero.woff2");
  expect(styles).toContain("/fonts/instrument-sans-latin.woff2");
  expect(styles).toContain("/fonts/ibm-plex-mono-latin-400.woff2");
  expect(styles).toContain("/fonts/ibm-plex-mono-latin-500.woff2");
  const requested = fullFace.join(" ");
  expect(requested).toContain("bricolage-hero.woff2");
  expect(requested).toContain("instrument-sans-latin.woff2");
  expect(requested).toContain("ibm-plex-mono");
  expect(requested).not.toContain("bricolage-grotesque-latin");
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      display: document.fonts.check('800 16px "Bricolage Grotesque"'),
      sans: document.fonts.check('400 16px "Instrument Sans"'),
      mono: document.fonts.check('400 16px "IBM Plex Mono"'),
    };
  });
  expect(loaded).toEqual({ display: true, sans: true, mono: true });
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

// The ticker is the one looping element on the landing (DESIGN.md §9). These
// tests pin the physical contract #4083 bought: it sits above the main page
// flow and holds its own height, it never widens the document, it does not
// shift layout, it stops for prefers-reduced-motion, and every item is a
// distinct real signal row.

test("the ticker sits above the page and reserves its height", async ({ page }) => {
  await page.goto(PATH);
  const ticker = page.locator("#ticker");
  await expect(ticker).toBeVisible();

  const box = await ticker.boundingBox();
  if (box === null) throw new Error("ticker has no box");
  expect(box.height).toBeGreaterThan(0);

  const mainFollowsTicker = await page.evaluate(() => {
    const ticker = document.getElementById("ticker");
    const main = document.querySelector("main");
    if (ticker === null || main === null) throw new Error("ticker or main missing");
    return (ticker.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
  expect(mainFollowsTicker).toBe(true);
});

test("the ticker never scrolls the page sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PATH);
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PATH);
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
});

test("the ticker causes no layout shift", async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.set(window, "__cls", 0);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!Reflect.get(entry, "hadRecentInput")) {
          Reflect.set(window, "__cls", Reflect.get(window, "__cls") + Reflect.get(entry, "value"));
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  await page.goto(PATH);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => Reflect.get(window, "__cls"))).toBeLessThan(0.05);
});

test("the ticker stops under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PATH);
  const animations = await page.evaluate(
    () => document.getElementById("ticker")?.getAnimations({ subtree: true }).length ?? 0,
  );
  expect(animations).toBe(0);
});

test("every ticker item is a real signal row, listed once", async ({ page }) => {
  await page.goto(PATH);
  const ids = await page
    .locator("#ticker li[data-signal-id]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-signal-id")));

  for (const id of ids) {
    expect(typeof id).toBe("string");
    expect((id ?? "").length).toBeGreaterThan(0);
  }
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBeLessThanOrEqual(12);
});
