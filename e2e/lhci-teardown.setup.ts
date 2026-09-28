import { expect, test as setup } from "@playwright/test";

// The lighthouse job's post-audit teardown (0509#5767). The sign-in mints a
// real user+workspace+send_target row set on every deploy and nothing removed
// it; this is the product's own delete path — the settings flow J14 proves in
// the browser — driven through the request fixture, so the job still needs no
// browser install. The session is minutes old, inside deleteSignedInUser's
// 24h fresh-session window (app/lib/auth.server.ts). The redirect to
// /login?deleted= is the proof the row is gone, the same way inbox.ts reads it.
setup("delete the signed-in e2e address", async ({ request, baseURL }) => {
  const cookie = process.env.BETTER_AUTH_SESSION_COOKIE;
  if (!cookie) throw new Error("BETTER_AUTH_SESSION_COOKIE is not set: the sign-in step recorded no session");
  const email = process.env.LHCI_EMAIL;
  if (!email) throw new Error("LHCI_EMAIL is not set: the sign-in step recorded no address");
  const accessHeaders = {
    "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID ?? "",
    "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
    origin: new URL(baseURL).origin,
    cookie,
  };
  const deleted = await request.post("/app/settings", {
    headers: accessHeaders,
    form: { intent: "delete-account", confirm: email },
    maxRedirects: 0,
  });
  expect(deleted.status()).toBe(302);
  expect(deleted.headers().location ?? "").toContain("/login?deleted=");
});
