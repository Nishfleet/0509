import { expect, test as setup } from "@playwright/test";

setup("delete the signed-in e2e address", async ({ request, baseURL }) => {
  if (!baseURL) throw new Error("baseURL is not set");
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
