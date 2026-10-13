import { expect, test } from "./test";

import { isLocalLane } from "./inbox";
import { seedRankedHomeSession } from "./ranked-home";

test.skip(
  !isLocalLane(),
  "seeds a ranked workspace in the local preview database and deletes its competitors; never run against production",
);

test("a customer who removes every competitor still gets working pages and a way to add one", async ({ page }) => {
  const cookie = await seedRankedHomeSession("forget-all");
  await page.setExtraHTTPHeaders({ cookie });

  for (const name of ["Kindred", "Casetta"]) {
    await page.goto("/app/competitors");
    await page
      .getByRole("link", { name: new RegExp(name) })
      .first()
      .click();
    await page.getByLabel(`Type ${name} to confirm`).fill(name);
    await page.getByRole("button", { name: `Remove and forget ${name}` }).click();
    await expect(page).toHaveURL(/\/app\/competitors$/);
  }

  await expect(page.getByText("Add a competitor to see where you stand.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Kindred|Casetta/ })).toHaveCount(0);

  for (const path of ["/app", "/app/brief", "/app/alerts"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page, path).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("main"), path).toBeVisible();
  }
});
