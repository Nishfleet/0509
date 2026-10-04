import { existsSync } from "node:fs";

import { expect, test as teardown } from "@playwright/test";

import { sessionStatePath } from "../playwright.config";

teardown.use({ storageState: existsSync(sessionStatePath) ? sessionStatePath : undefined });

teardown("delete the shared session account", async ({ request, baseURL }) => {
  if (!existsSync(sessionStatePath)) return;

  const response = await request.get("/api/auth/get-session");
  if (response.status() !== 200) {
    throw new Error(`GET /api/auth/get-session answered HTTP ${response.status()} (expected 200)`);
  }
  const body: unknown = await response.json();
  let email: string | null = null;
  if (body && typeof body === "object" && "user" in body) {
    const user = (body as { user?: { email?: string } }).user;
    if (user && typeof user.email === "string" && user.email.length > 0) {
      email = user.email;
    }
  }
  if (!email) return;

  if (!baseURL) throw new Error("PLAYWRIGHT_TEST_BASE_URL resolved to no baseURL");
  const deleted = await request.post("/app/settings", {
    headers: { origin: new URL(baseURL).origin },
    form: { intent: "delete-account", confirm: email },
    maxRedirects: 0,
  });
  expect(deleted.status()).toBe(302);
  const location = deleted.headers().location ?? "";
  if (location.includes("/login?deleted=")) return;
  // The suite's own teardown already deleted this row; the always() rerun
  // (e2e-scheduled.yml) then posts with a leftover cookie and settings sends
  // the visitor to /login with no deleted query.
  expect(location, "already-deleted session tears down as a login redirect").toMatch(/\/login(?:\?|$)/);
});
