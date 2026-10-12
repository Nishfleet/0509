import { expect, test } from "@playwright/test";

const SIGNED_IN_PAGES = [
  "/app",
  "/app/competitors",
  "/app/competitors/missing-brand",
  "/app/alerts",
  "/app/settings",
  "/app/settings/agents",
  "/app/upgrade",
  "/app/tester",
  "/app/logos/missing-brand",
];

test("every signed-in page sends a signed-out visitor to the login page", async ({ request }) => {
  for (const path of SIGNED_IN_PAGES) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBeGreaterThanOrEqual(300);
    expect(response.status(), path).toBeLessThan(400);
    expect(new URL(response.headers().location ?? "", response.url()).pathname, path).toBe("/login");
  }
});

test("the pause-the-brief form does nothing for a signed-out visitor", async ({ request }) => {
  const response = await request.post("/app/settings/brief-pause", {
    form: { value: "pause" },
    maxRedirects: 0,
  });
  const status = response.status();
  if (status >= 300 && status < 400) {
    expect(new URL(response.headers().location ?? "", response.url()).pathname).toBe("/login");
  } else {
    expect([401, 403]).toContain(status);
  }
});

test("the web-bot-auth key directory is either a signed-keys document or a plain 404", async ({ request }) => {
  const response = await request.get("/.well-known/http-message-signatures-directory", { maxRedirects: 0 });
  if (response.status() === 404) return;
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/application\/http-message-signatures-directory\+json/);
  expect(response.headers()["cache-control"]).toContain("public");
});
