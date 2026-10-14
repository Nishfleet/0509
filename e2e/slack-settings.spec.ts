import type { DatabaseSync } from "node:sqlite";

import { isLocalLane, run, seedPreviewSession } from "./inbox";
import { scanPage, seedCompetitor, seedWorkspace, signIn, startQuality } from "./quality";
import { expect, test } from "./test";

test.skip(!isLocalLane(), "seeds a workspace in the local preview database; never run against production");

test.setTimeout(120_000);

const STAMP = "2026-10-01T00:00:00.000Z";
const WEBHOOK = "https://hooks.slack.com/services/T0000000/B0000000/abcdefgh12345678";

function seedSlackTarget(db: DatabaseSync, workspaceId: string, verified: boolean): void {
  run(
    db,
    "INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at) VALUES (?, ?, 'chan-slack', ?, ?, ?)",
    `slack-${workspaceId}`,
    workspaceId,
    WEBHOOK,
    verified ? 1 : 0,
    STAMP,
  );
}

test("Slack alerts start unconnected and refuse an address that is not a Slack webhook", async ({
  page,
  baseURL,
}, testInfo) => {
  const quality = await startQuality(page);
  const { cookie } = await seedPreviewSession("slack-new", ({ db, suffix, userId }) => {
    seedCompetitor(db, suffix, seedWorkspace(db, suffix, userId));
  });
  await signIn(page, baseURL, cookie);
  await page.goto("/app/settings");

  const section = page.getByTestId("slack-alerts-setting");
  await expect(section.getByRole("heading", { name: "Slack alerts" })).toBeVisible();
  await expect(section).toContainText("Make an incoming webhook in Slack and paste its address here.");
  await expect(section.getByTestId("slack-reconnect")).toHaveCount(0);
  await scanPage(page, testInfo, quality, `/app/settings slack unconnected ${testInfo.project.name}`, {
    screen: /^settings$/i,
    keyboard: true,
  });

  await section.getByLabel("Slack webhook address").fill("https://example.com/not-slack");
  await section.getByRole("button", { name: "Connect Slack" }).click();
  await expect(section.getByRole("alert")).toContainText("That is not a Slack webhook address.");
  await expect(section.getByRole("button", { name: "Connect Slack" })).toBeVisible();
  await expect(section.getByRole("button", { name: "Disconnect Slack" })).toHaveCount(0);
});

test("a connected Slack shows Disconnect, and disconnecting brings the address field back", async ({
  page,
  baseURL,
}) => {
  const { cookie } = await seedPreviewSession("slack-on", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId);
    seedCompetitor(db, suffix, workspaceId);
    seedSlackTarget(db, workspaceId, true);
  });
  await signIn(page, baseURL, cookie);
  await page.goto("/app/settings");

  const section = page.getByTestId("slack-alerts-setting");
  await expect(section).toContainText(
    "Price and plan changes, and your weekly brief, also post to your Slack channel.",
  );
  await expect(section.getByLabel("Slack webhook address")).toHaveCount(0);
  await expect(section.getByTestId("slack-reconnect")).toHaveCount(0);

  await section.getByRole("button", { name: "Disconnect Slack" }).click();
  await expect(section.getByLabel("Slack webhook address")).toBeVisible();
  await expect(section.getByRole("button", { name: "Connect Slack" })).toBeVisible();
  await expect(section.getByTestId("slack-reconnect")).toHaveCount(0);
});

test("a webhook Slack revoked tells the owner to reconnect and says email alerts keep arriving", async ({
  page,
  baseURL,
}, testInfo) => {
  const quality = await startQuality(page);
  const { cookie } = await seedPreviewSession("slack-revoked", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId);
    seedCompetitor(db, suffix, workspaceId);
    seedSlackTarget(db, workspaceId, false);
  });
  await signIn(page, baseURL, cookie);
  await page.goto("/app/settings");

  const section = page.getByTestId("slack-alerts-setting");
  await expect(section.getByTestId("slack-reconnect")).toHaveText(
    "Slack stopped accepting our posts, so we disconnected it. Paste a new webhook address to reconnect. Your alerts keep arriving by email.",
  );
  await expect(section.getByLabel("Slack webhook address")).toBeVisible();
  await expect(section.getByRole("button", { name: "Connect Slack" })).toBeVisible();
  await scanPage(page, testInfo, quality, `/app/settings slack revoked ${testInfo.project.name}`, {
    screen: /^settings$/i,
    keyboard: true,
  });
});

test("a revoked Slack webhook with price and plan alerts off says nothing is being sent", async ({
  page,
  baseURL,
}, testInfo) => {
  const quality = await startQuality(page);
  const { cookie } = await seedPreviewSession("slack-revoked-off", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId);
    seedCompetitor(db, suffix, workspaceId);
    seedSlackTarget(db, workspaceId, false);
    run(db, "UPDATE workspace SET change_alerts = 0 WHERE id = ?", workspaceId);
  });
  await signIn(page, baseURL, cookie);
  await page.goto("/app/settings");

  await expect(page.getByTestId("slack-alerts-setting").getByTestId("slack-reconnect")).toHaveText(
    "Slack stopped accepting our posts, so we disconnected it. Paste a new webhook address to reconnect. Price and plan alerts are off, so nothing is sent by email or to Slack. Switch them on above.",
  );
  await scanPage(page, testInfo, quality, `/app/settings slack revoked alerts off ${testInfo.project.name}`, {
    screen: /^settings$/i,
    keyboard: true,
  });
});
