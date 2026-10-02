import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { readRawMessage, requireInboxToken, signInWithMagicLink } from "./inbox";
import { captureIds, counts, log, messageHeaders } from "./proof-4012-lib";

test.skip(!process.env.PLAYWRIGHT_TEST_BASE_URL, "proof for 0509#4012 runs against production only");

const WAIT_MS = 120_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("0509#4012 rich workspace delete: counts, delete through Settings, counts, inbox quiet", async ({ page }) => {
  test.setTimeout(1_200_000);
  const token = requireInboxToken();
  const [email, storedWorkspaceId] = readFileSync("e2e/proof-4012-rich.email", "utf8").trim().split("\n");
  expect(email).toMatch(/^e2e\+[0-9a-f]{12}@0509\.io$/);
  expect(email).not.toContain("soak");
  const ids = captureIds(email);
  log("ids", { email, workspaceId: ids.workspaceId, stored: storedWorkspaceId, watches: ids.watches.length });
  expect(ids.workspaceId).toBe(storedWorkspaceId);
  const before = counts(ids);
  log("COUNTS BEFORE", before);

  await signInWithMagicLink(page, email, token, /\/app/);
  const inboxBefore = messageHeaders(await readRawMessage(email, token));
  log("inbox before delete", inboxBefore);

  await page.goto("/app/settings");
  await page.getByLabel("Type " + email + " to confirm").fill(email);
  const deleteClickedAt = new Date().toISOString();
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.waitForURL(/\/login\?deleted=/);
  const instanceId = new URL(page.url()).searchParams.get("deleted") ?? "";
  log("delete", { deleteClickedAt, instanceId });
  expect(instanceId).not.toBe("");

  await expect
    .poll(
      async () => {
        await page.goto("/login?deleted=" + encodeURIComponent(instanceId));
        return page.locator('section[data-delete="progress"]').innerText();
      },
      { timeout: 300_000, intervals: [5_000] },
    )
    .toMatch(/Saved page copies and screenshots: removed \(\d+ files?\)/);
  const progressText = await page.locator('section[data-delete="progress"]').innerText();
  const removed = /removed \((\d+) files?\)/.exec(progressText)?.[1] ?? "?";
  log("progress section text", progressText);
  log("REMOVED FILE COUNT N", removed);

  const after = counts(ids);
  log("COUNTS AFTER", after);
  const nonZero = Object.entries(after).filter(([, n]) => n !== 0);
  log("nonZeroAfter", nonZero);

  await sleep(WAIT_MS);
  const inboxAfter = messageHeaders(await readRawMessage(email, token));
  log("inbox after delete+wait", { waitedMs: WAIT_MS, checkedAt: new Date().toISOString(), inboxAfter });

  expect(nonZero).toEqual([]);
  expect(inboxAfter).toEqual(inboxBefore);
});
