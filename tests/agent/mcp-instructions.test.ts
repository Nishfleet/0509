import { describe, expect, test, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { mcpInstructions } from "../../app/lib/agent/mcp.server";
import type { FreshnessSource } from "../../app/lib/freshness.server";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");

function source(key: string, kind: string, overrides: Partial<FreshnessSource["source"]> = {}): FreshnessSource {
  return {
    kind,
    source: {
      key,
      platform: key.split(".")[0],
      name: key,
      is_enabled: 1,
      config_json: null,
      degraded_reason: null,
      last_good_at: null,
      ...overrides,
    },
    snapshot: null,
  };
}

describe("mcpInstructions", () => {
  test("an all-disabled registry names no capability family", () => {
    const instructions = mcpInstructions(
      [
        source("ads.amazon_parked", "ads", { is_enabled: 0 }),
        source("ads.apple_parked", "ads", { is_enabled: 0 }),
        source("ads.pinterest_parked", "ads", { config_json: '{"state":"parked"}' }),
        source("hiring.ashby", "hiring", { is_enabled: 0 }),
        source("hiring.greenhouse", "hiring", { is_enabled: 0 }),
        source("mentions.gdelt", "mentions", { is_enabled: 0 }),
      ],
      NOW,
    );
    expect(instructions).toBe(
      "Five to Nine watches the user's competitors (public sources) and ranks the user against them every week. Everything here is read-only and limited to the signed-in user's own account.",
    );
  });

  test("a mixed registry names exactly the enabled families", () => {
    const instructions = mcpInstructions(
      [
        source("ads.amazon", "ads"),
        source("ads.apple", "ads", { is_enabled: 0 }),
        source("gdelt.doc", "mentions", { degraded_reason: "not answering" }),
        source("hn.algolia", "mentions"),
        source("hiring.ashby", "hiring", { is_enabled: 0 }),
        source("site.web", "site"),
      ],
      NOW,
    );
    expect(instructions).toBe(
      "Five to Nine watches the user's competitors (ads, mentions, and site checks) and ranks the user against them every week. Everything here is read-only and limited to the signed-in user's own account.",
    );
  });
});
