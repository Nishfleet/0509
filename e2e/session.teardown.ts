import { existsSync } from "node:fs";

import { expect, test as teardown } from "@playwright/test";

import { sessionStatePath } from "../playwright.config";

// Deletes the account the session setup minted (0509#6034), through the
// product's own settings delete path — the same POST lhci-teardown drives and
// J14 proves in the browser. The context's request shares the jar the
// storageState loaded, so the session cookie authenticates the delete without
// a re-sign-in; the 302 to /login?deleted= is the proof the row is gone, the
// same way inbox.ts reads it. When the session file was never written (the
// setup failed before saving) there is no session and the teardown is a no-op.
teardown.use({ storageState: existsSync(sessionStatePath) ? sessionStatePath : undefined });

teardown("delete the shared session account", async ({ context, baseURL }) => {
  if (!baseURL) throw new Error("PLAYWRIGHT_TEST_BASE_URL resolved to no baseURL");
  // The session authority's own answer: /api/auth/get-session returns the
  // session's user when the jar holds one and null when it does not.
  const session = await context.request.get(`${baseURL}/api/auth/get-session`);
  if (session.status() !== 200) {
    throw new Error(`GET /api/auth/get-session answered HTTP ${session.status()} (expected 200)`);
  }
  const body: unknown = await session.json();
  const email =
    body && typeof body === "object" && "user" in body
      ? (body as { user?: { email?: string } }).user?.email
      : undefined;
  // The setup never minted a session, so there is nothing to delete.
  if (!email) return;

  const deleted = await context.request.post("/app/settings", {
    headers: { origin: new URL(baseURL).origin },
    form: { intent: "delete-account", confirm: email },
    maxRedirects: 0,
  });
  expect(deleted.status()).toBe(302);
  expect(deleted.headers().location ?? "").toContain("/login?deleted=");
});
