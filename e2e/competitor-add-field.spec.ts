import { expect, test } from "./test";

import { isLocalLane } from "./inbox";
import { seedRankedHomeSession } from "./ranked-home";

test.skip(!isLocalLane(), "seeds a ranked workspace in the local preview database; never run against production");

test("after adding a competitor the field is empty and the new brand is listed", async ({ page }) => {
  const cookie = await seedRankedHomeSession("add-field");
  await page.setExtraHTTPHeaders({ cookie });
  await page.goto("/app/competitors");

  const field = page.getByLabel("Add a competitor we missed");
  await field.fill("example.com");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByRole("list", { name: "Competitors" }).getByText("example.com")).toBeVisible();
  await expect(field).toHaveValue("");
  await expect(page.getByRole("status").filter({ hasText: "Added. We're reading their site now." })).toBeVisible();
});

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
