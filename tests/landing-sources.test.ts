import { describe, expect, it } from "vitest";

import { landingSources } from "../app/lib/landing-sources";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const FRESH = { fetched_at: "2026-09-26T11:00:00.000Z", item_count: 3 };
const INTERNAL = JSON.stringify({
  note: "internal only",
  state: "degraded",
  reason: "blocked",
  last_good_at: "2026-09-20T00:00:00.000Z",
});

function source(key: string, config: string, enabled = 1) {
  return {
    kind: "mentions",
    snapshot: FRESH,
    source: { key, platform: key, name: key, is_enabled: enabled, config_json: config, watch_config_json: null },
  };
}

describe("landingSources", () => {
  it("carries no config_json or internal note for any row", () => {
    const rows = landingSources([source("a", "{}"), source("b", INTERNAL)], NOW);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.source).not.toHaveProperty("config_json");
      expect(row.source).not.toHaveProperty("watch_config_json");
    }
    expect(JSON.stringify(rows)).not.toContain("internal only");
  });

  it("keeps a config-degraded source degraded with its reason and last good time", () => {
    const [row] = landingSources([source("b", INTERNAL)], NOW);
    expect(row?.source.degraded_reason).toBe("blocked");
    expect(row?.source.last_good_at).toBe("2026-09-20T00:00:00.000Z");
  });

  it("drops disabled and parked rows", () => {
    const rows = landingSources([source("c", "{}", 0), source("d", JSON.stringify({ state: "parked" }))], NOW);
    expect(rows).toHaveLength(0);
  });
});
