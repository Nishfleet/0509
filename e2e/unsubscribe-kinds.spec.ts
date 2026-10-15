import type { DatabaseSync } from "node:sqlite";

import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";
import { scanPage, seedWorkspace, signIn, startQuality } from "./quality";

test.skip(!isLocalLane(), "the seeded session and send targets only exist on the preview Worker");

const STAMP = "2026-10-12T00:00:00.000Z";

function addTarget(
  db: DatabaseSync,
  id: string,
  workspaceId: string,
  address: string,
  role: "owner" | "teammate",
  confirmed: boolean,
): string {
  const token = `unsub-${id}`;
  run(
    db,
    "INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at, role, unsubscribe_token) SELECT ?, ?, id, ?, ?, ?, ?, ? FROM channel WHERE key = 'email'",
    id,
    workspaceId,
    address,
    confirmed ? 1 : 0,
    STAMP,
    role,
    token,
  );
  return token;
}

test("a brief's unsubscribe link stops only the brief, offers stopping everything, and Settings shows both switches", async ({
  page,
  baseURL,
}, testInfo) => {
  const { cookie, seeded } = await seedPreviewSession("unsub-kinds", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId, "Unsub Kinds");
    return addTarget(db, `st-owner-${suffix}`, workspaceId, `unsub-kinds-${suffix}@0509.io`, "owner", true);
  });
  await signIn(page, baseURL, cookie);
  const quality = await startQuality(page);

  await page.goto(`/u/${seeded}?type=brief`);
  await expect(page.getByRole("heading", { level: 1, name: "Stop the weekly brief?" })).toBeVisible();
  await expect(page.getByText("Alerts keep coming.")).toBeVisible();

  await page.goto("/app/settings");
  const before = page.getByRole("region", { name: "Emails to this address" });
  await expect(before.getByLabel("The weekly brief")).toBeChecked();
  await expect(before.getByLabel("Alerts, when a competitor changes or your site has trouble")).toBeChecked();

  await page.goto(`/u/${seeded}?type=brief`);
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "You're unsubscribed" })).toBeVisible();
  await expect(page.getByText(/We won't send the weekly brief to this address any more\./)).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/app/settings");

  await page.goto("/app/settings");
  const after = page.getByRole("region", { name: "Emails to this address" });
  await expect(after.getByLabel("The weekly brief")).not.toBeChecked();
  await expect(after.getByLabel("Alerts, when a competitor changes or your site has trouble")).toBeChecked();
  await scanPage(page, testInfo, quality, "Settings with the brief stopped", {
    screen: /^settings$/i,
    keyboard: false,
  });

  await page.goto(`/u/${seeded}?type=brief`);
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await page.getByRole("button", { name: "Stop everything instead" }).click();
  await expect(
    page.getByText(/We won't send the weekly brief and all alerts to this address any more\./),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop everything instead" })).toHaveCount(0);

  await page.goto("/app/settings");
  const none = page.getByRole("region", { name: "Emails to this address" });
  await expect(none.getByLabel("The weekly brief")).not.toBeChecked();
  await expect(none.getByLabel("Alerts, when a competitor changes or your site has trouble")).not.toBeChecked();
});

test("an alerts link stops only alerts, and an old link without a type stops both", async ({ page, baseURL }) => {
  const { cookie, seeded } = await seedPreviewSession("unsub-alerts", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId, "Unsub Alerts");
    return addTarget(db, `st-owner-${suffix}`, workspaceId, `unsub-alerts-${suffix}@0509.io`, "owner", true);
  });
  await signIn(page, baseURL, cookie);

  await page.goto(`/u/${seeded}?type=alerts`);
  await expect(page.getByRole("heading", { level: 1, name: "Stop alerts?" })).toBeVisible();
  await expect(page.getByText("The weekly brief keeps coming.")).toBeVisible();
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(page.getByText(/We won't send alerts to this address any more\./)).toBeVisible();

  await page.goto("/app/settings");
  const kinds = page.getByRole("region", { name: "Emails to this address" });
  await expect(kinds.getByLabel("The weekly brief")).toBeChecked();
  await expect(kinds.getByLabel("Alerts, when a competitor changes or your site has trouble")).not.toBeChecked();

  await page.goto(`/u/${seeded}`);
  await expect(page.getByRole("heading", { level: 1, name: "Unsubscribe from Five to Nine emails?" })).toBeVisible();
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(
    page.getByText(/We won't send the weekly brief and all alerts to this address any more\./),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop everything instead" })).toHaveCount(0);
});

test("a teammate who unsubscribes gets teammate wording, then shows as unsubscribed to the owner, who can still remove them", async ({
  page,
  baseURL,
}) => {
  const mate = { address: "" };
  const { cookie, seeded } = await seedPreviewSession("unsub-mate", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId, "Unsub Mate");
    mate.address = `mate-${suffix}@example.com`;
    return addTarget(db, `st-mate-${suffix}`, workspaceId, mate.address, "teammate", true);
  });

  await page.goto(`/u/${seeded}?type=brief`);
  await expect(page.getByRole("heading", { level: 1, name: "Stop the weekly brief?" })).toBeVisible();
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "You're unsubscribed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop everything instead" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "support@0509.io" }).first()).toBeVisible();

  await signIn(page, baseURL, cookie);
  await page.goto("/app/settings");
  const row = page.getByRole("listitem").filter({ hasText: mate.address });
  await expect(row).toContainText("unsubscribed");
  await row.getByRole("button", { name: `Remove ${mate.address}` }).click();
  await expect(page.getByRole("listitem").filter({ hasText: mate.address })).toHaveCount(0);

  const old = await page.goto(`/u/${seeded}`);
  expect(old?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "This unsubscribe link is no longer active" }),
  ).toBeVisible();
  await expect(page.getByText("the person who added you took you off their list")).toBeVisible();
});

test("the welcome email's Open your first look target opens Home for a signed-in customer", async ({
  page,
  baseURL,
}) => {
  const { cookie } = await seedPreviewSession("welcome-home", ({ db, suffix, userId }) => {
    seedWorkspace(db, suffix, userId, "Welcome Home");
  });
  await signIn(page, baseURL, cookie);
  await page.goto("/app");
  expect(new URL(page.url()).pathname).toBe("/app");
  await expect(page.getByRole("heading", { level: 1, name: /^good (morning|afternoon|evening)/i })).toBeVisible();
});
