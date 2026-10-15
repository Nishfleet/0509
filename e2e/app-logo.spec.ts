import { expect, test } from "./test";

import { isLocalLane, seedPreviewSession } from "./inbox";
import { seedCompetitor, seedWorkspace, signIn } from "./quality";

test.skip(!isLocalLane(), "seeds two workspaces in the local preview database; never run against production");

test("a logo link answers 404 for a brand that is not in your workspace, and never leaks another workspace's", async ({
  page,
  baseURL,
}) => {
  const owner = await seedPreviewSession("logo-owner", ({ db, suffix, userId }) => {
    return seedCompetitor(db, suffix, seedWorkspace(db, suffix, userId));
  });
  const stranger = await seedPreviewSession("logo-stranger", ({ db, suffix, userId }) => {
    seedWorkspace(db, suffix, userId);
  });
  await signIn(page, baseURL, stranger.cookie);

  const missing = await page.request.get("/app/logos/ent-does-not-exist");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["cache-control"]).toContain("no-store");
  expect(await missing.text()).toBe("That logo isn't here.");

  const foreign = await page.request.get(`/app/logos/${owner.seeded}`);
  expect(foreign.status()).toBe(404);
  expect(await foreign.text()).toBe("That logo isn't here.");
});
