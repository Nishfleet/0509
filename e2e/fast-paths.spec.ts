import { expect, test } from "./test";

import { isLocalLane } from "./inbox";
import { seedRankedHomeSession } from "./ranked-home";

test.skip(!isLocalLane(), "seeds a ranked workspace in the local preview database; never run against production");

test("the add-a-competitor field comes before the list, one Tab after the nav", async ({ page }) => {
  const cookie = await seedRankedHomeSession("fast-add");
  await page.setExtraHTTPHeaders({ cookie });
  await page.goto("/app/competitors");

  const field = page.getByLabel("Add a competitor we missed");
  const list = page.getByRole("list", { name: "Competitors" });
  const fieldBox = await field.boundingBox();
  const listBox = await list.boundingBox();
  expect(fieldBox?.y ?? Infinity).toBeLessThan(listBox?.y ?? 0);

  await page.getByRole("link", { name: "Settings", exact: true }).first().focus();
  await page.keyboard.press("Tab");
  await expect(field).toBeFocused();
});

test("the Alerts jump on Settings puts the next Tab on the first alert switch", async ({ page }) => {
  const cookie = await seedRankedHomeSession("fast-alerts");
  await page.setExtraHTTPHeaders({ cookie });
  await page.goto("/app/settings");

  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Alerts" }).click();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("switch", { name: /Immediate alerts for your own site/ })).toBeFocused();
});
