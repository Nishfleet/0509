import { readFileSync, writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { nextBriefAt } from "../app/lib/brief-schedule";
import { readSettings } from "./proof-4062-a.spec";

test.use({ storageState: "e2e/.auth/proof-session.json" });
test.setTimeout(180_000);

test("proof 4062 phase B: second brief-day change", async ({ page }) => {
  const evidence = JSON.parse(readFileSync("e2e/.auth/proof.json", "utf8"));
  const before2 = await readSettings(page);
  const day2 = (before2.day + 2) % 7;
  const saveAt = new Date();
  const saved = page.waitForResponse((r) => r.url().includes("/app/settings") && r.request().method() === "POST");
  await page.getByLabel("Day").selectOption(String(day2));
  console.log("change2 POST status", (await saved).status());
  await expect.poll(async () => (await readSettings(page)).day).toBe(day2);
  const after2 = await readSettings(page);
  const tz = before2.timezone;
  const oldSchedule = { timezone: tz, weekday: before2.day, hour: before2.hour };
  const newSchedule = { timezone: tz, weekday: day2, hour: before2.hour };
  const out = {
    ...evidence,
    before2,
    after2,
    changeAtApprox: saveAt.toISOString(),
    expectedStaleUtc: nextBriefAt(oldSchedule, saveAt).toISOString(),
    expectedFreshUtc: nextBriefAt(newSchedule, saveAt).toISOString(),
  };
  writeFileSync("e2e/.auth/proof.json", JSON.stringify(out, null, 2));
  console.log("PROOF_B " + JSON.stringify(out));
});
