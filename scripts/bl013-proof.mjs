#!/usr/bin/env node
/**
 * BL-013 live proof from the local fixture harness.
 * Usage: node scripts/bl013-proof.mjs <label> <outDir>
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const label = process.argv[2] ?? "after";
const outDir = process.argv[3] ?? "/home/nish/workspaces/products/0509-audit-artifacts-bl013";
const base = "http://127.0.0.1:4179";

mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const personas = [
  {
    user: "e2e-agency",
    slug: "branded",
    watchlistId: "e2e-watchlist-agency-1",
    expectBrand: "Agency Fixture Studio",
  },
  {
    user: "e2e-agency-unbranded",
    slug: "unbranded",
    watchlistId: "e2e-watchlist-agency-unbranded-1",
    expectBrand: null,
  },
];

const results = [];
const browser = await chromium.launch();

async function withFixtureContext(viewport, user, fn) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
  });
  await context.addCookies([
    { name: "f9_e2e_fixture", value: user, url: base, sameSite: "Lax" },
  ]);
  await context.route(`${base}/**`, (route) =>
    route.continue({
      headers: { ...route.request().headers(), "x-0509-e2e-test-mode": "1" },
    }),
  );
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  try {
    return await fn(page, consoleErrors);
  } finally {
    await context.close();
  }
}

async function mintShareUrl(page, watchlistId) {
  await page.goto(`${base}/app/reports/watchlist:${watchlistId}`, { waitUntil: "networkidle" });
  const reviewed = page.locator('input[type="checkbox"][name="reviewed"]');
  await reviewed.check();
  const shareForm = page.locator("form").filter({
    has: page.locator('input[name="intent"][value="share-report"]'),
  });
  await shareForm.getByRole("button", { name: "Send to client" }).click();
  await page.waitForSelector('a[href*="/share/"]', { timeout: 15_000 });
  const href = await page.locator('a[href*="/share/"]').last().getAttribute("href");
  if (!href) throw new Error("share URL missing");
  return href.startsWith("http") ? href : `${base}${href}`;
}

async function captureSurface(page, consoleErrors, file, checks = {}) {
  await page.waitForTimeout(500);
  const metrics = await page.evaluate(() => {
    const renderedLineCharacterCounts = (node) => {
      const lineCounts = new Map();
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        for (let index = 0; index < textNode.textContent.length; index += 1) {
          if (/\s/.test(textNode.textContent[index])) continue;
          const range = document.createRange();
          range.setStart(textNode, index);
          range.setEnd(textNode, index + 1);
          const rect = range.getBoundingClientRect();
          const lineTop = Math.round(rect.top * 2) / 2;
          lineCounts.set(lineTop, (lineCounts.get(lineTop) ?? 0) + 1);
        }
        textNode = walker.nextNode();
      }
      return [...lineCounts.values()];
    };
    const textMetrics = (node) => {
      const rect = node.getBoundingClientRect();
      const computed = getComputedStyle(node);
      const lineHeight = Number.parseFloat(computed.lineHeight);
      const estimatedLines = Number.isFinite(lineHeight) && lineHeight > 0
        ? Math.ceil(rect.height / lineHeight)
        : null;
      const lineCharacterCounts = renderedLineCharacterCounts(node);
      return {
        text: (node.textContent ?? "").trim(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        lineHeight: Number.isFinite(lineHeight) ? Math.round(lineHeight * 10) / 10 : null,
        estimatedLines,
        lineCharacterCounts,
        maxCharactersOnOneLine: Math.max(0, ...lineCharacterCounts),
      };
    };
    const factRailLabels = [...document.querySelectorAll(".f9-evidence-fact-key")]
      .map(textMetrics)
      .map((metric) => ({
        ...metric,
        // Word wrapping is acceptable ("Still" / "live" / "at"). A letter
        // stack has many rendered lines but never fits more than two visible
        // characters on any one line.
        letterStacked:
          metric.estimatedLines !== null &&
          metric.estimatedLines > 2 &&
          metric.maxCharactersOnOneLine <= 2,
      }));
    const headlineNumbers = [...document.querySelectorAll(".f9-evidence-report-number-value")]
      .map(textMetrics)
      .map((metric) => ({
        ...metric,
        readable: metric.estimatedLines !== null && metric.estimatedLines <= 3,
      }));

    return {
      docHeight: Math.round(document.documentElement.scrollHeight),
      scrollWidth: Math.round(document.documentElement.scrollWidth),
      innerWidth: window.innerWidth,
      cover: Boolean(document.querySelector(".f9-evidence-report-cover")),
      plates: document.querySelectorAll(".f9-evidence-evidence-plate").length,
      toolbarHeading: document.querySelectorAll(".f9-panel-toolbar-heading").length,
      fiveToNineInDocument: (document.querySelector("[data-report-root]")?.textContent ?? "").includes(
        "Five to Nine",
      ),
      factRailLabels,
      letterStackedFactRailLabels: factRailLabels
        .filter((metric) => metric.letterStacked)
        .map((metric) => metric.text),
      headlineNumbers,
      readableHeadlineNumberCount: headlineNumbers.filter((metric) => metric.readable).length,
      overflowing: [...document.querySelectorAll("body *")]
        .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 5)
        .map((node) => `${node.tagName.toLowerCase()}.${node.className}`.slice(0, 90)),
    };
  });
  await page.screenshot({ path: file, fullPage: true });
  return {
    ...metrics,
    horizontalOverflow: metrics.scrollWidth - metrics.innerWidth,
    consoleErrors: [...consoleErrors],
    screenshot: file,
    ...checks,
  };
}

for (const vp of viewports) {
  for (const persona of personas) {
    const shareUrl = await withFixtureContext(vp, persona.user, async (page) =>
      mintShareUrl(page, persona.watchlistId),
    );

    const anonymous = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    await anonymous.route(`${base}/**`, (route) =>
      route.continue({
        headers: { ...route.request().headers(), "x-0509-e2e-test-mode": "1" },
      }),
    );
    const page = await anonymous.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

    await page.goto(shareUrl, { waitUntil: "networkidle" });
    if (persona.expectBrand) {
      await page.waitForSelector(".f9-share-brand-identity", { timeout: 10_000 });
    } else {
      await page.waitForSelector(".f9-wordmark", { timeout: 10_000 });
    }
    results.push({
      label,
      persona: persona.slug,
      surface: "share",
      viewport: vp.name,
      ...(await captureSurface(
        page,
        consoleErrors,
        `${outDir}/${label}-share-${persona.slug}-${vp.name}.png`,
        { shareUrl, expectBrand: persona.expectBrand },
      )),
    });

    const pdfVariantUrl = `${shareUrl}${shareUrl.includes("?") ? "&" : "?"}pdf=1`;
    await page.goto(pdfVariantUrl, { waitUntil: "networkidle" });
    results.push({
      label,
      persona: persona.slug,
      surface: "pdf-variant",
      viewport: vp.name,
      ...(await captureSurface(
        page,
        consoleErrors,
        `${outDir}/${label}-pdf-variant-${persona.slug}-${vp.name}.png`,
      )),
    });

    await anonymous.close();
  }

  const expired = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  await expired.route(`${base}/**`, (route) =>
    route.continue({
      headers: { ...route.request().headers(), "x-0509-e2e-test-mode": "1" },
    }),
  );
  const expiredPage = await expired.newPage();
  const expiredErrors = [];
  expiredPage.on("console", (msg) => {
    if (msg.type() === "error") expiredErrors.push(msg.text());
  });
  await expiredPage.goto(`${base}/share/expired-fixture-token`, { waitUntil: "networkidle" });
  results.push({
    label,
    persona: "anonymous",
    surface: "expired-share",
    viewport: vp.name,
    ...(await captureSurface(
      expiredPage,
      expiredErrors,
      `${outDir}/${label}-expired-share-${vp.name}.png`,
    )),
  });
  await expired.close();
}

await browser.close();
writeFileSync(`${outDir}/${label}-metrics.json`, JSON.stringify(results, null, 2));
writeFileSync(
  `${outDir}/deletion-ledger.md`,
  `# BL-013 deletion ledger\n\n- \`.f9-share-page .f9-report-page\` panel double-frame (replaced by \`.f9-share-report\` transparent wrapper)\n- Share report toolbar (\`f9-panel-toolbar f9-report-toolbar\` with duplicate cover subject)\n- ProofGlossary product-name sentence on deliverable audience path\n`,
);
console.log(
  results
    .map(
      (r) =>
        `${r.viewport} ${r.persona}/${r.surface} — height ${r.docHeight}px, overflow ${r.horizontalOverflow}px, cover ${r.cover}, plates ${r.plates}, headline numbers ${r.readableHeadlineNumberCount}/${r.headlineNumbers.length} readable, letter-stacked labels ${r.letterStackedFactRailLabels.length}, toolbar headings ${r.toolbarHeading}, console errors ${r.consoleErrors.length}`,
    )
    .join("\n"),
);

const pdfLayoutFailures = results
  .filter((result) => result.surface === "pdf-variant")
  .filter(
    (result) =>
      result.headlineNumbers.length !== 3 ||
      result.readableHeadlineNumberCount !== 3 ||
      result.letterStackedFactRailLabels.length > 0,
  );
if (pdfLayoutFailures.length > 0) {
  throw new Error(
    `PDF layout proof failed: ${pdfLayoutFailures
      .map(
        (result) =>
          `${result.viewport}/${result.persona} numbers=${result.readableHeadlineNumberCount}/${result.headlineNumbers.length} stacked=${result.letterStackedFactRailLabels.join(",") || "none"}`,
      )
      .join("; ")}`,
  );
}
