import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

interface HiringSourceRow {
  id: string;
  key: string;
  kind: string;
  platform: string;
  plugin_key: string;
  reliability: string;
  is_enabled: number;
  config_json: string;
}

const EXPECTED_HIRING_SOURCES: readonly HiringSourceRow[] = [
  {
    id: "src_hiring_ashby",
    key: "hiring.ashby",
    kind: "hiring",
    platform: "ashby",
    plugin_key: "hiring.board",
    reliability: "official_api",
    is_enabled: 1,
    config_json: "{}",
  },
  {
    id: "src_hiring_greenhouse",
    key: "hiring.greenhouse",
    kind: "hiring",
    platform: "greenhouse",
    plugin_key: "hiring.board",
    reliability: "official_api",
    is_enabled: 1,
    config_json: "{}",
  },
  {
    id: "src_hiring_lever",
    key: "hiring.lever",
    kind: "hiring",
    platform: "lever",
    plugin_key: "hiring.board",
    reliability: "official_api",
    is_enabled: 1,
    config_json: "{}",
  },
  {
    id: "src_hiring_smartrecruiters",
    key: "hiring.smartrecruiters",
    kind: "hiring",
    platform: "smartrecruiters",
    plugin_key: "hiring.board",
    reliability: "official_api",
    is_enabled: 1,
    config_json: "{}",
  },
  {
    id: "src_hiring_workable",
    key: "hiring.workable",
    kind: "hiring",
    platform: "workable",
    plugin_key: "hiring.board",
    reliability: "official_api",
    is_enabled: 1,
    config_json: "{}",
  },
];

describe("job-board source rows", () => {
  it("seeds exactly the five enabled official hiring sources", async () => {
    const rows = await env.DB.prepare(
      `SELECT id, key, kind, platform, plugin_key, reliability, is_enabled, config_json
       FROM source
       WHERE kind = 'hiring'
       ORDER BY id`,
    ).all<HiringSourceRow>();

    expect(rows.results ?? []).toEqual(EXPECTED_HIRING_SOURCES);
  });
});
