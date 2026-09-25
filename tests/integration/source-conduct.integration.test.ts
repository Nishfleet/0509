import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

/**
 * Collection conduct on every `source` registry row (#5147, the P10.5a slice of
 * engine 10 / #4078; docs/engines/guardrails.md § P10.5).
 *
 * The rate that governs a source and whether it honours robots.txt live in the
 * row's `config_json`, not in an adapter, so a source's conduct is data the
 * registry carries. Migration 0021 records both for every row that exists when
 * it runs; these assertions run against the real local D1 with the real
 * migrations applied — a mocked binding cannot see the schema.
 *
 * The values: `honoured` = robots.txt is obeyed; `logged_out_browser` =
 * competitor public pages are fetched only as a logged-out browser would see
 * them (Nish, 2026-09-21); `api_terms` = an official API its terms govern.
 */

describe("collection conduct on every source row (#5147, P10.5a)", () => {
  it("leaves no source row without a robots policy", async () => {
    const missing = await env.DB.prepare(
      "SELECT key FROM source WHERE json_extract(config_json, '$.robots') IS NULL",
    ).all<{ key: string }>();
    expect(missing.results ?? []).toEqual([]);
  });

  it("records GDELT's six-second pace on its registry row", async () => {
    // The pace workers/workflows/mentions.ts keeps with `PACE = "6 seconds"`.
    const row = await env.DB.prepare(
      `SELECT json_extract(config_json, '$.min_interval_seconds') AS s
       FROM source WHERE key = 'gdelt.doc'`,
    ).first<{ s: number }>();
    expect(row?.s).toBe(6);
  });

  it("splits the site source's own site from a competitor's public page", async () => {
    const row = await env.DB.prepare(
      `SELECT json_extract(config_json, '$.robots.self') AS self,
              json_extract(config_json, '$.robots.competitor') AS competitor
       FROM source WHERE key = 'site.web'`,
    ).first<{ self: string; competitor: string }>();
    expect(row?.self).toBe("honoured");
    expect(row?.competitor).toBe("logged_out_browser");
  });
});
