import { expect, test } from "@playwright/test";

// The four headers the launch audit (V16) could not find on `/` come from
// public/_headers, which Workers applies to static-asset responses only. `/`
// is a static asset, so this asserts the edge rule, plus the nosniff that ships
// in the same block; the React routes get the same set (plus a per-response
// nonce) from app/lib/security-headers.ts, which tests/security-headers.test.ts
// already covers.
test("GET / sends the static origin's security headers", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const headers = response.headers();

  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["strict-transport-security"]).toContain("max-age=31536000");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("same-origin");
  expect(headers["x-content-type-options"]).toBe("nosniff");
});
