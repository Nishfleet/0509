import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";
import { seedCompetitor, seedWorkspace, signIn } from "./quality";

test.skip(
  !isLocalLane(),
  "seeds workspaces of chosen ages in the local preview database; never run against production",
);

const DAY_MS = 86_400_000;
const NO_RIVAL = /You're not watching a competitor yet\./;
const ONE_RIVAL = /You are watching one competitor\./;

async function openHome(
  page: Parameters<typeof signIn>[0],
  baseURL: string | undefined,
  prefix: string,
  ageDays: number,
  rivals: number,
): Promise<void> {
  const { cookie } = await seedPreviewSession(prefix, ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId);
    run(
      db,
      "UPDATE workspace SET created_at = ? WHERE id = ?",
      new Date(Date.now() - ageDays * DAY_MS).toISOString(),
      workspaceId,
    );
    if (rivals > 0) seedCompetitor(db, suffix, workspaceId);
    if (rivals > 1) {
      run(
        db,
        "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', ?, 'Second Rival', 'on', ?)",
        `ent-b-${suffix}`,
        workspaceId,
        `second-${suffix}.example`,
        new Date().toISOString(),
      );
    }
  });
  await signIn(page, baseURL, cookie);
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("after three days with no rival, Home says so once and Add a competitor opens Competitors", async ({
  page,
  baseURL,
}) => {
  await openHome(page, baseURL, "nudge-none", 4, 0);
  await expect(page.getByText(NO_RIVAL)).toHaveCount(1);
  await page.getByRole("link", { name: "Add a competitor" }).click();
  await expect(page).toHaveURL(/\/app\/competitors$/);
});

test("after three days with one rival, Home asks for a second in its own words", async ({ page, baseURL }) => {
  await openHome(page, baseURL, "nudge-one", 4, 1);
  await expect(page.getByText(ONE_RIVAL)).toHaveCount(1);
  await expect(page.getByText(NO_RIVAL)).toHaveCount(0);
});

test("a workspace under three days old, or with two rivals, sees no nudge", async ({ page, baseURL }) => {
  await openHome(page, baseURL, "nudge-new", 1, 0);
  await expect(page.getByRole("link", { name: "Add a competitor" })).toHaveCount(0);

  await page.context().clearCookies();
  await openHome(page, baseURL, "nudge-two", 4, 2);
  await expect(page.getByText(NO_RIVAL)).toHaveCount(0);
  await expect(page.getByText(ONE_RIVAL)).toHaveCount(0);
});
