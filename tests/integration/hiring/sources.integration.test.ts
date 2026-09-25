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

// Migration 0023 (P10.5a, #5147) writes the source's conduct policy into every
// row's config_json. The hiring board sources fall through the migration's
// `ELSE 'api_terms'` branch (kind='hiring', plugin_key='hiring.board'), so the
// JSON now carries the registry's robots policy — the row no longer matches
// the literal `{}` the migration-time fixture pinned.
const HIRING_ROBOTS_POLICY = JSON.stringify({ robots: "api_terms" });

const EXPECTED_HIRING_SOURCES: readonly HiringSourceRow[] = [
  {
    id: "src_hiring_ashby",
    key: "hiring.ashby",
    kind: "hiring",
    platform: "ashby",
    plugin_key: "hiring.board",
    reliability: "official_api",
    is_enabled: 0,
    config_json: HIRING_ROBOTS_POLICY,
  },
  {
    id: "src_hiring_greenhouse",
    key: "hiring.greenhouse",
    kind: "hiring",
    platform: "greenhouse",
    plugin_key: "hiring.board",
    reliability: "official_api",
    is_enabled: 0,
    config_json: HIRING_ROBOTS_POLICY,
  },
  {
    id: "src_hiring_lever",
    key: "hiring.lever",
    kind: "hiring",
    platform: "lever",
    plugin_key: "hiring.board",
    reliability: "official_api",
    is_enabled: 0,
    config_json: HIRING_ROBOTS_POLICY,
  },
  {
    id: "src_hiring_smartrecruiters",
    key: "hiring.smartrecruiters",
    kind: "hiring",
    platform: "smartrecruiters",
    plugin_key: "hiring.board",
    reliability: "official_api",
    is_enabled: 0,
    config_json: HIRING_ROBOTS_POLICY,
  },
  {
    id: "src_hiring_workable",
    key: "hiring.workable",
    kind: "hiring",
    platform: "workable",
    plugin_key: "hiring.board",
    reliability: "official_api",
    is_enabled: 0,
    config_json: HIRING_ROBOTS_POLICY,
  },
];

describe("job-board source rows", () => {
  it("seeds exactly the five official hiring sources, disabled", async () => {
    const rows = await env.DB.prepare(
      `SELECT id, key, kind, platform, plugin_key, reliability, is_enabled, config_json
       FROM source
       WHERE kind = 'hiring'
       ORDER BY id`,
    ).all<HiringSourceRow>();

    expect(rows.results ?? []).toEqual(EXPECTED_HIRING_SOURCES);
  });
});
