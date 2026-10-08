import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("the feed.rss source after the migrations", () => {
  it("is enabled for every workspace: no pilot account is named", async () => {
    const row = await env.DB.prepare("SELECT is_enabled, config_json FROM source WHERE key = 'feed.rss'").first<{
      is_enabled: number;
      config_json: string;
    }>();

    expect(row?.is_enabled).toBe(1);
    expect(JSON.parse(row?.config_json ?? "null")).toEqual({ robots: "honoured" });
  });
});
