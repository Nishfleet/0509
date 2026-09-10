import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchCreativesByDomain } from "~/lib/sources/google-ads/google-ads-transparency.server";

const FIXTURE_DIR = resolve(__dirname, "../fixtures/google-ads-transparency");

describe("debug", () => {
  it("shows the result", async () => {
    const body = readFileSync(resolve(FIXTURE_DIR, "nike.com-page1.json"), "utf8");
    const fetchImpl = (async () => new Response(body, { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const result = await fetchCreativesByDomain("nike.com", { fetchImpl });
    console.log("RESULT:", JSON.stringify(result, null, 2).slice(0, 500));
    expect(true).toBe(true);
  });
});
