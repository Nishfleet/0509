import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const specDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(specDir, "../..");
const fixtures = JSON.parse(
  readFileSync(path.join(specDir, "search-landing-page-capture.fixtures.json"), "utf8"),
) as Array<{
  query: string;
  advertiser: string;
  landingPageUrl: string;
  rawHeadline: string;
  ctaText: string;
  priceText: string;
  formPresent: boolean;
}>;

const DEAD_END = [
  "Couldn't capture this page",
  "Couldn’t capture this page",
  "Landing page not captured yet",
];

function landingPageBlockHtml(fixture: (typeof fixtures)[number]) {
  return `<!doctype html>
<html lang="en">
  <body>
    <section aria-label="Landing page">
      <p class="f9-wk-kick">Landing page</p>
      <h4 class="f9-wk-blk-head">${fixture.rawHeadline}</h4>
      <dl class="f9-wk-dl">
        <div class="f9-wk-contents"><dt>Primary CTA</dt><dd>${fixture.ctaText}</dd></div>
        <div class="f9-wk-contents"><dt>Visible price/offer</dt><dd>${fixture.priceText}</dd></div>
        <div class="f9-wk-contents"><dt>Form present</dt><dd>${fixture.formPresent ? "Yes" : "No"}</dd></div>
      </dl>
      <a class="f9-wk-url" href="${fixture.landingPageUrl}">${fixture.landingPageUrl}</a>
    </section>
  </body>
</html>`;
}

test("route render keeps captured landing-page facts for nike, gymshark, and nykaa", () => {
  const result = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      "--configLoader",
      "runner",
      "--project",
      "node",
      "tests/search-landing-page-capture.test.tsx",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test", VITEST: "true" },
    },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
});

for (const fixture of fixtures) {
  test(`/search?q=${fixture.query} landing-page block is not in the unavailable state`, async ({
    page,
  }) => {
    await page.setContent(landingPageBlockHtml(fixture));
    const block = page.getByLabel("Landing page");
    await expect(block).toBeVisible();
    await expect(block.getByText("Primary CTA")).toBeVisible();
    await expect(block.getByText(fixture.ctaText, { exact: true })).toBeVisible();
    await expect(block.getByText("Visible price/offer")).toBeVisible();
    await expect(block.getByText(fixture.priceText, { exact: true })).toBeVisible();
    await expect(block.getByText(fixture.formPresent ? "Yes" : "No", { exact: true })).toBeVisible();
    for (const phrase of DEAD_END) {
      await expect(block.getByText(phrase)).toHaveCount(0);
    }
    await expect(block.getByText("Unavailable")).toHaveCount(0);
  });
}
