import { existsSync } from "node:fs";

import { expect, request as apiRequest, test as teardown } from "@playwright/test";

import { sessionStatePath } from "../playwright.config";

// Deletes the account the session setup minted (0509#6034), through the
// product's own settings delete path — the same POST lhci-teardown drives and
// J14 proves in the browser. The jar is built from the file inside the test,
// not at module load: every test file loads before any project runs, so a
// load-time existsSync is always false on a clean checkout and the teardown
// would run with no session at all. The 302 to /login?deleted= is the proof
// the row is gone, the same way inbox.ts reads it.
teardown("delete the shared session account", async ({ baseURL }) => {
  // The file is absent when the setup failed before saving — the run minted
  // no session and there is nothing to delete.
  if (!existsSync(sessionStatePath)) return;
  if (!baseURL) throw new Error("PLAYWRIGHT_TEST_BASE_URL resolved to no baseURL");

  const request = await apiRequest.newContext({ baseURL, storageState: sessionStatePath });
  try {
    // The session authority's own answer: /api/auth/get-session returns the
    // session's user when the jar holds one and null when it does not.
    // Stopped before redirects: a jar whose session died mid-run is answered
    // by the app's own bounce, which also means nothing left to delete.
    const session = await request.get("/api/auth/get-session", { maxRedirects: 0 });
    if (session.status() >= 300 && session.status() < 400) return;
    if (session.status() !== 200) {
      throw new Error(`GET /api/auth/get-session answered HTTP ${session.status()} (expected 200)`);
    }
    if (!(session.headers()["content-type"] ?? "").includes("application/json")) return;
    const body: unknown = await session.json();
    const email =
      body && typeof body === "object" && "user" in body
        ? (body as { user?: { email?: string } }).user?.email
        : undefined;
    if (!email) return;

    const deleted = await request.post("/app/settings", {
      headers: { origin: new URL(baseURL).origin },
      form: { intent: "delete-account", confirm: email },
      maxRedirects: 0,
    });
    expect(deleted.status()).toBe(302);
    expect(deleted.headers().location ?? "").toContain("/login?deleted=");
  } finally {
    await request.dispose();
  }
});
