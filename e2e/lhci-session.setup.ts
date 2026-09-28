import { appendFileSync } from "node:fs";

import { expect, test as setup } from "@playwright/test";

import { requireInboxToken, waitForMagicLink } from "./inbox";

// The lighthouse job's signed-in audit (0509#5767). There is no test-session
// shortcut in the app, so this is J1's sign-in driven through the request
// fixture: no browser, so the job needs no `playwright install`. The cookie
// lands in GITHUB_ENV and lighthouserc.cjs sends it next to CF_Authorization.
setup("sign in a fresh e2e address and record the session cookie", async ({ request, baseURL }) => {
  const token = requireInboxToken();
  const githubEnv = process.env.GITHUB_ENV;
  if (!githubEnv) throw new Error("GITHUB_ENV is not set: the session cookie has nowhere to be recorded");
  // The service-token headers clear the Access gate and pre-clear Turnstile
  // server side (accessPrecleared), the same as J1's browser lane. better-auth
  // checks Origin on the sign-in POST the way the app's own form does.
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

  // The session is only proven when the gate accepts it: /app must answer
  // without bouncing to /login (a fresh workspace lands on /onboarding).
  const app = await request.get("/app", { headers: accessHeaders });
  expect(new URL(app.url()).pathname.startsWith("/login")).toBe(false);

  const state = await request.storageState();
  const session = state.cookies.find((cookie) => cookie.name.endsWith("better-auth.session_token"));
  if (!session) throw new Error(`magic-link verify set no session cookie for ${email}`);
  appendFileSync(githubEnv, `BETTER_AUTH_SESSION_COOKIE=${session.name}=${session.value}\n`);
  appendFileSync(githubEnv, `LHCI_EMAIL=${email}\n`);
});
