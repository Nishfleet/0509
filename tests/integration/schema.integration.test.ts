import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * The migration, proven in real workerd against real D1 rather than in sqlite3.
 *
 * Pins counts and the two facts that took a correction to get right: the
 * better-auth tables are the CLI's, not hand-written, and `user` carries no
 * pre-rebuild columns.
 */
describe("0001_rebuild.sql", () => {
  it("creates the whole schema and nothing else", async () => {
    const tables = await env.DB.prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations' AND name NOT LIKE '_cf_%'",
    ).first<{ n: number }>();
    // 31 from the rebuild chain, plus support_report (0509#4229).
    expect(tables?.n).toBe(32);
    const support = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = 'support_report'",
    ).first();
    expect(support).not.toBeNull();
  });

  it("carries better-auth's six generated tables", async () => {
    for (const name of ["user", "session", "account", "verification", "passkey", "apikey"]) {
      const row = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      ).bind(name).first();
      expect(row, `${name} must exist`).not.toBeNull();
    }
  });

  it("leaves no pre-rebuild column on user", async () => {
    const cols = await env.DB.prepare("SELECT name FROM pragma_table_info('user')").all<{ name: string }>();
    const names = (cols.results ?? []).map((c) => c.name);
    expect(names).not.toContain("signup_source");
    expect(names).not.toContain("onboardedAt");
  });
});
