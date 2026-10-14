import { isLocalLane, run, seedPreviewSession } from "./inbox";
import { SCHEMES, scanPage, seedWorkspace, signIn, startQuality } from "./quality";
import { expect, test } from "./test";

test.skip(
  !isLocalLane(),
  "seeds a workspace with no competitors in the local preview database; never run against production",
);

test.setTimeout(180_000);

const SCREENS = [
  { path: "/app", says: "Add a competitor to see where you stand." },
  { path: "/app/competitors", says: "Add a competitor to see where you stand. We also look for new ones every week." },
  { path: "/app/brief", says: "Your weekly brief" },
  { path: "/app/alerts", says: "Nothing yet. When a competitor changes its website, gets a mention or posts a job" },
  { path: "/app/settings", says: "Also send the brief to" },
] as const;

test("a brand-new workspace with no competitors explains every screen and passes the quality checks", async ({
  page,
  baseURL,
}, testInfo) => {
  const quality = await startQuality(page);
  const { cookie } = await seedPreviewSession("quality-empty", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId);
    run(
      db,
      "INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at, watching_started_at) SELECT ?, ?, owner_user_id, 'self.example', ?, ? FROM workspace WHERE id = ?",
      `run-${suffix}`,
      workspaceId,
      "2026-09-25T00:00:00.000Z",
      "2026-09-25T00:00:00.000Z",
      workspaceId,
    );
  });
  await signIn(page, baseURL, cookie);

  for (const screen of SCREENS) {
    const response = await page.goto(screen.path);
    expect(response?.status(), screen.path).toBe(200);
    await expect(page.getByRole("main"), screen.path).toContainText(screen.says);
    await expect(page.getByRole("main"), screen.path).not.toContainText(/\b(?:undefined|null|NaN)\b|\{\{/);
    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(width.scroll, `${screen.path}: no sideways scroll`).toBeLessThanOrEqual(width.inner);
    for (const colorScheme of SCHEMES) {
      await page.emulateMedia({ colorScheme });
      await scanPage(page, testInfo, quality, `${screen.path} empty ${colorScheme} ${testInfo.project.name}`);
    }
  }
});
