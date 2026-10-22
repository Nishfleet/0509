import { describe, expect, it } from "vitest";

import { lintTextAt } from "./eslint-lint-text";

const RULE_MESSAGE = "live-workspace sweep rule";

const SWEEP_MODULE = "workers/standing/rollover-plan.ts";
const DATA_MODULE = "app/lib/data/page.server.ts";
const NON_SWEEP_MODULE = "app/lib/feeds/read-feed.server.ts";
const EXEMPT_MODULE = "app/lib/data/active-workspace.ts";

const literal = (sql: string) => `export const QUERY = ${JSON.stringify(sql)};\n`;

const withHelper = (sql: string) =>
  `import { liveWorkspace } from "../../app/lib/data/active-workspace";\nexport const QUERY = \`${sql} AND \${liveWorkspace("e.workspace_id")}\`;\n`;

async function reported(rel: string, code: string): Promise<boolean> {
  const result = await lintTextAt(rel, code);
  expect(result.ignored).toBe(false);
  return result.messages.some((message) => message.includes(RULE_MESSAGE));
}

describe("eslint live-workspace sweep rule (0509#5774)", () => {
  it.each([
    "SELECT w.id FROM workspace w WHERE w.timezone = 'UTC'",
    "SELECT e.id FROM entity e WHERE e.state = 'on'",
    "SELECT e.id FROM signal s JOIN entity e ON e.id = s.entity_id WHERE s.kind = 'change'",
    "SELECT w.id FROM watch w WHERE w.is_active = 1",
    "SELECT p.id FROM page p WHERE p.role = 'home'",
    "select p.id from Page p where p.role = 'home'",
    "SELECT s.id FROM plan s JOIN workspace w ON w.id = s.workspace_id",
  ])("reports a sweep read with no live-workspace filter: %s", { timeout: 60_000 }, async (sql) => {
    expect(await reported(SWEEP_MODULE, literal(sql))).toBe(true);
    expect(await reported(DATA_MODULE, literal(sql))).toBe(true);
  });

  it("reports a template literal that never calls the helper", { timeout: 60_000 }, async () => {
    const code = "const state = 'on';\nexport const QUERY = `SELECT e.id FROM entity e WHERE e.state = ${state}`;\n";
    expect(await reported(SWEEP_MODULE, code)).toBe(true);
  });

  it("passes a sweep read built with the shared helper", { timeout: 60_000 }, async () => {
    expect(await reported(SWEEP_MODULE, withHelper("SELECT e.id FROM entity e WHERE e.state = 'on'"))).toBe(false);
    expect(await reported(DATA_MODULE, withHelper("SELECT e.id FROM entity e JOIN page p ON p.entity_id = e.id"))).toBe(
      false,
    );
  });

  it("passes a sweep read that names fixture itself", { timeout: 60_000 }, async () => {
    const sql = "SELECT w.id FROM workspace w WHERE w.fixture = 0";
    expect(await reported(SWEEP_MODULE, literal(sql))).toBe(false);
  });

  it("passes a per-request read bound to one row", { timeout: 60_000 }, async () => {
    expect(await reported(DATA_MODULE, literal("SELECT id FROM entity WHERE id = ?1 AND workspace_id = ?2"))).toBe(
      false,
    );
    expect(await reported(DATA_MODULE, literal("SELECT w.id FROM workspace w WHERE w.owner_user_id = ?"))).toBe(false);
  });

  it(
    "still reports the all-workspaces guard that a bound read would otherwise excuse",
    { timeout: 60_000 },
    async () => {
      const sql =
        "SELECT s.id FROM signal s JOIN entity e ON e.id = s.entity_id WHERE (?1 IS NULL OR s.workspace_id = ?1)";
      expect(await reported(DATA_MODULE, literal(sql))).toBe(true);
    },
  );

  it(
    "skips a parenthesised fragment and still reports the host statement that embeds it",
    { timeout: 60_000 },
    async () => {
      const fragment = "(SELECT count(*) FROM entity e WHERE e.workspace_id = w.id AND e.state = 'on')";
      const host = `const COUNT = ${JSON.stringify(fragment)};\nexport const QUERY = \`SELECT w.id, \${COUNT} AS rivals FROM workspace w\`;\n`;
      expect(await reported(SWEEP_MODULE, literal(fragment))).toBe(false);
      expect(await reported(SWEEP_MODULE, host)).toBe(true);
    },
  );

  it("does not check SQL that reads no workspace, entity, watch or page", { timeout: 60_000 }, async () => {
    expect(await reported(SWEEP_MODULE, literal("SELECT id FROM digest WHERE status = 'pending'"))).toBe(false);
  });

  it("does not check a module outside the sweep globs", { timeout: 60_000 }, async () => {
    expect(await reported(NON_SWEEP_MODULE, literal("SELECT e.id FROM entity e WHERE e.state = 'on'"))).toBe(false);
  });

  it("does not check a module named in the exemptFiles option", { timeout: 60_000 }, async () => {
    expect(await reported(EXEMPT_MODULE, literal("SELECT e.id FROM entity e WHERE e.state = 'on'"))).toBe(false);
  });
});
