import { existsSync } from "node:fs";

import { test as teardown } from "@playwright/test";

import { sessionStatePath } from "../playwright.config";
import { deleteAccountViaRequest } from "./inbox";

teardown.use({ storageState: existsSync(sessionStatePath) ? sessionStatePath : undefined });

teardown("delete the shared session account", async ({ request, baseURL }) => {
  if (!existsSync(sessionStatePath)) return;
  if (!baseURL) throw new Error("PLAYWRIGHT_TEST_BASE_URL resolved to no baseURL");
  // #7247: this teardown deletes one production account and inherits the 30s
  // default, which one delete already crossed (20.5s in run 37580626642's
  // rerun). 120s is six times the longest single delete this lane has logged.
  teardown.setTimeout(120_000);
  await deleteAccountViaRequest(request, new URL(baseURL).origin);
});
