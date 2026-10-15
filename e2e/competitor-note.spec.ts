import type { Page } from "@playwright/test";

import { expect, test } from "./test";

import { isLocalLane } from "./inbox";
import { seedRankedHomeSession } from "./ranked-home";

async function saveNote(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.getByRole("button", { name: "Save note" }).click(),
  ]);
}

test.skip(
  !isLocalLane(),
  "seeds a ranked workspace in the local preview database and writes a note on its competitor; never run against production",
);

test("a customer writes a private note on a rival and finds it again after a reload", async ({ page }) => {
  const cookie = await seedRankedHomeSession("note");
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app/competitors");
  await page
    .getByRole("link", { name: /Kindred/ })
    .first()
    .click();
  await expect(
    page.getByText("Only people signed in to your workspace can see this. It is never emailed."),
  ).toBeVisible();
  const field = page.getByLabel("What you know about them");
  await expect(field).toHaveValue("");
  await field.fill("They discount every Q4.");
  await saveNote(page);
  await expect(field).toHaveValue("They discount every Q4.");

  await page.reload();
  await expect(page.getByLabel("What you know about them")).toHaveValue("They discount every Q4.");
});

test("saving an empty note clears it", async ({ page }) => {
  const cookie = await seedRankedHomeSession("note-clear");
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app/competitors");
  await page
    .getByRole("link", { name: /Kindred/ })
    .first()
    .click();
  const field = page.getByLabel("What you know about them");
  await field.fill("Raise their enterprise tier at renewal.");
  await saveNote(page);
  await page.reload();
  await expect(page.getByLabel("What you know about them")).toHaveValue("Raise their enterprise tier at renewal.");

  await page.getByLabel("What you know about them").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await expect(page.getByLabel("What you know about them")).toHaveValue("");
  await saveNote(page);
  await page.reload();
  await expect(page.getByLabel("What you know about them")).toHaveValue("");
});
