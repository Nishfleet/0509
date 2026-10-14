import { type Page, type TestInfo } from "@playwright/test";
import { expect, test } from "./test";

import { isLocalLane, seedPreviewSession } from "./inbox";
import { SCHEMES, scanPage, seedCompetitor, seedWorkspace, signIn, startQuality } from "./quality";

test.skip(
  !isLocalLane(),
  "the preview Worker signs in through a seeded session; production has the dedicated a11y specs",
);

test.setTimeout(180_000);

const PUBLIC_PAGES = [
  "/",
  "/pricing",
  "/privacy",
  "/terms",
  "/security",
  "/status",
  "/login",
  "/api/docs",
  "/v/probe-token",
];

async function sweep(page: Page, testInfo: TestInfo, paths: string[]): Promise<void> {
  const quality = await startQuality(page);
  for (const path of paths) {
    for (const colorScheme of SCHEMES) {
      await page.emulateMedia({ colorScheme });
      const response = await page.goto(path);
      const label = `${path} ${colorScheme} ${testInfo.project.name}`;
      expect.soft(response?.status(), `${label}: status`).toBe(200);
      await scanPage(page, testInfo, quality, label, { keyboard: colorScheme === "light" });
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
    "/app",
    "/app/alerts",
    "/app/competitors",
    `/app/competitors/${seeded}`,
    "/app/brief",
    "/app/settings",
    "/app/settings/agents",
  ]);
});

test("the onboarding steps pass axe, keyboard focus, layout shift and the console guard", async ({
  page,
  baseURL,
}, testInfo) => {
  const { cookie } = await seedPreviewSession(
    "quality-input",
    ({ db, suffix, userId }) => {
      seedWorkspace(db, suffix, userId);
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, cookie);
  await sweep(page, testInfo, ["/onboarding"]);
});
