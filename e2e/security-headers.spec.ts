import { expect, test } from "./test";

const PERMISSIONS = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()";

const SHARED = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": PERMISSIONS,
};

test.describe("browser hardening headers", () => {
  test("GET /og.png sends the static origin's security headers", async ({ request }) => {
    const response = await request.get("/og.png");
    expect(response.status()).toBe(200);
    const headers = response.headers();

    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers).toMatchObject(SHARED);
  });

  for (const path of ["/", "/pricing", "/login", "/no-such-page"]) {
    test(`GET ${path} sends the Worker's security headers with a per-response nonce`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      const csp = headers["content-security-policy"] ?? "";

      expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=_-]+'/);
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(headers).toMatchObject({ ...SHARED, "cross-origin-resource-policy": "same-origin" });
    });
  }

  test("a redirect to sign-in still carries HSTS and nosniff", async ({ request }) => {
    const response = await request.get("/app", { maxRedirects: 0 });
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["strict-transport-security"]).toContain("max-age=31536000");
  });

  test("a JSON endpoint is never sniffed and is HTTPS-only", async ({ request }) => {
    const response = await request.get("/api/auth/get-session", { maxRedirects: 0 });
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["strict-transport-security"]).toContain("max-age=31536000");
  });
});
