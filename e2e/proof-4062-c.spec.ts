import { readFileSync } from "node:fs";

import { test } from "@playwright/test";

import { deleteCreatedAccount } from "./inbox";

test.use({ storageState: "e2e/.auth/proof-session.json" });
test.setTimeout(180_000);

test("proof 4062 cleanup: delete only the fresh test account", async ({ page }) => {
  const email = readFileSync("e2e/.auth/proof.email", "utf8").trim();
  if (!/^e2e\+[0-9a-f]{12}@0509\.io$/.test(email)) throw new Error("refusing to delete a non-fresh account");
  await deleteCreatedAccount(page, email);
  console.log("PROOF_C deleted " + email + " at " + new Date().toISOString());
});
