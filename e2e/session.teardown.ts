import { existsSync } from "node:fs";

import { test as teardown } from "@playwright/test";

import { sessionStatePath } from "../playwright.config";
import { deleteAccountViaRequest } from "./inbox";

teardown.use({ storageState: existsSync(sessionStatePath) ? sessionStatePath : undefined });

teardown("delete the shared session account", async ({ request, baseURL }) => {
  if (!existsSync(sessionStatePath)) return;
  if (!baseURL) throw new Error("PLAYWRIGHT_TEST_BASE_URL resolved to no baseURL");
  await deleteAccountViaRequest(request, new URL(baseURL).origin);
});
