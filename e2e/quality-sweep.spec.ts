import { type Page, type TestInfo } from "@playwright/test";
import { expect, test } from "./test";

import { isLocalLane, seedPreviewSession } from "./inbox";
import { SCHEMES, scanPage, seedBareWorkspace, seedCompetitor, seedWorkspace, signIn, startQuality } from "./quality";

test.skip(
  !isLocalLane(),
  "the preview Worker signs in through a seeded session; production has the dedicated a11y specs",
);

test.setTimeout(180_000);

const PUBLIC_PAGES: [string, RegExp][] = [
  ["/", /quietly, we.re rebuilding/i],
  ["/pricing", /pick how closely you watch/i],
  ["/privacy", /privacy policy/i],
  ["/terms", /terms of service/i],
  ["/security", /^security$/i],
  ["/status", /^status$/i],
  ["/login", /^sign in$/i],
  ["/api/docs", /api reference/i],
  ["/v/probe-token", /confirm this email address/i],
];

async function sweep(page: Page, testInfo: TestInfo, screens: [string, RegExp][]): Promise<void> {
  const quality = await startQuality(page);
  for (const [path, screen] of screens) {
    for (const colorScheme of SCHEMES) {
      await page.emulateMedia({ colorScheme });
      const response = await page.goto(path);
      const label = `${path} ${colorScheme} ${testInfo.project.name}`;
      expect.soft(response?.status(), `${label}: status`).toBe(200);
      await scanPage(page, testInfo, quality, label, { screen, keyboard: colorScheme === "light" });
    }
  }
}

test("every signed-out page passes axe, keyboard focus, layout shift and the console guard", async ({
  page,
}, testInfo) => {
  await sweep(page, testInfo, PUBLIC_PAGES);
});

test("every signed-in page passes axe, keyboard focus, layout shift and the console guard", async ({
  page,
  baseURL,
}, testInfo) => {
  const { cookie, seeded } = await seedPreviewSession("quality-app", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId);
    return seedCompetitor(db, suffix, workspaceId);
  });
  await signIn(page, baseURL, cookie);
  await sweep(page, testInfo, [
    ["/app", /^good (morning|afternoon|evening)/i],
    ["/app/alerts", /^alerts$/i],
    ["/app/competitors", /^competitors$/i],
    [`/app/competitors/${seeded}`, /^zephyrwear$/i],
    ["/app/brief", /your weekly brief/i],
    ["/app/settings", /^settings$/i],
    ["/app/settings/agents", /agents and api/i],
  ]);
});

test("the onboarding steps pass axe, keyboard focus, layout shift and the console guard", async ({
  page,
  baseURL,
}, testInfo) => {
  const { cookie } = await seedPreviewSession(
    "quality-input",
    ({ db, suffix, userId }) => {
      seedBareWorkspace(db, suffix, userId);
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, cookie);
  await sweep(page, testInfo, [["/onboarding", /your website or social username/i]]);
});
