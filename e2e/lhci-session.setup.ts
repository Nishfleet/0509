import { appendFileSync } from "node:fs";

import { expect, test as setup } from "@playwright/test";

import { requireInboxToken, waitForMagicLink } from "./inbox";

setup("sign in a fresh e2e address and record the session cookie", async ({ request, baseURL }) => {
  if (!baseURL) throw new Error("baseURL is not set");
  const token = requireInboxToken();
  const githubEnv = process.env.GITHUB_ENV;
  if (!githubEnv) throw new Error("GITHUB_ENV is not set: the session cookie has nowhere to be recorded");

  const accessHeaders = {
    "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID ?? "",
    "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
    origin: new URL(baseURL).origin,
  };
  const email = `e2e+lhci-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  const sent = await request.post("/api/auth/sign-in/magic-link", {
    headers: accessHeaders,
    data: { email, callbackURL: "/onboarding" },
  });
  expect(sent.status()).toBe(200);

  const link = await waitForMagicLink(email, token);
  const response = await request.get(link, { headers: accessHeaders });
  expect(response.ok()).toBe(true);

  const app = await request.get("/app", { headers: accessHeaders });
  expect(new URL(app.url()).pathname.startsWith("/login")).toBe(false);

  const state = await request.storageState();
  const session = state.cookies.find((cookie) => cookie.name.endsWith("better-auth.session_token"));
  if (!session) throw new Error(`magic-link verify set no session cookie for ${email}`);
  appendFileSync(githubEnv, `BETTER_AUTH_SESSION_COOKIE=${session.name}=${session.value}\n`);
  appendFileSync(githubEnv, `LHCI_EMAIL=${email}\n`);
});
