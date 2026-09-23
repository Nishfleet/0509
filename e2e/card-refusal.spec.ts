import { expect, test } from "@playwright/test";

test("an unknown public card slug is a 404, not a 403, and sets no cookie", async ({ request }) => {
  const slug = crypto.randomUUID().replaceAll("-", "");
  const response = await request.get(`/s/${slug}?cb=${crypto.randomUUID()}`, { maxRedirects: 0 });
  expect(response.status()).toBe(404);
  expect(response.headers()["cache-control"]).toBe("public, s-maxage=60");
  const cookies = response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
  expect(cookies.filter((c) => !c.startsWith("CF_Authorization="))).toEqual([]);
});

test("an unknown slug with a file extension is also a 404", async ({ request }) => {
  const slug = crypto.randomUUID().replaceAll("-", "");
  const response = await request.get(`/s/${slug}.png?cb=${crypto.randomUUID()}`, { maxRedirects: 0 });
  expect(response.status()).toBe(404);
  expect(response.headers()["cache-control"]).toBe("public, s-maxage=60");
  const cookies = response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
  expect(cookies.filter((c) => !c.startsWith("CF_Authorization="))).toEqual([]);
});
