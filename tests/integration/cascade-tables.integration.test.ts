import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const CASCADE_EDGES_QUERY = `SELECT m.name AS child, f."table" AS parent
  FROM sqlite_master m
  JOIN pragma_foreign_key_list(m.name) f
  WHERE m.type = 'table' AND f.on_delete = 'CASCADE' AND m.name NOT LIKE '_cf_%'`;

async function cascadeClosure(): Promise<string[]> {
  const { results } = await env.DB.prepare(CASCADE_EDGES_QUERY).all<{
    child: string;
    parent: string;
  }>();
  const edges = results ?? [];
  let reached = new Set<string>(["workspace"]);
  let grew = true;
  while (grew) {
    const next = new Set(reached);
    for (const edge of edges) {
      if (reached.has(edge.parent)) {
        next.add(edge.child);
      }
    }
    grew = next.size !== reached.size;
    reached = next;
  }
  reached.delete("workspace");
  return [...reached].sort();
}

async function workspaceIdTables(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT m.name AS name
     FROM sqlite_master m
     JOIN pragma_table_info(m.name) c
     WHERE m.type = 'table' AND c.name = 'workspace_id'
       AND m.name NOT LIKE 'sqlite_%'
       AND m.name NOT LIKE '_cf_%'
       AND m.name NOT LIKE '%_hold'
       AND m.name <> 'd1_migrations'`,
  ).all<{ name: string }>();
  return (results ?? []).map((row) => row.name);
}

describe("workspace cascade coverage", () => {
  it("has foreign keys on", async () => {
    const row = await env.DB.prepare("PRAGMA foreign_keys").first<{ foreign_keys: number }>();
    expect(row).toEqual({ foreign_keys: 1 });
  });

  it("cascade from workspace reaches exactly the owned tables", async () => {
    expect(await cascadeClosure()).toEqual([
      "alert",
      "digest",
      "discovery_backlog",
      "entity",
      "incident",
      "incident_notice",
      "jev_verdict",
      "onboarding_run",
      "page",
      "plan",
      "send_attempt",
      "send_target",
      "signal",
      "signal_delivery",
      "snapshot",
      "standing",
      "suggestion",
      "user_decision",
      "watch",
    ]);
  });

  it("every table with workspace_id is owned by the cascade", async () => {
    const closure = await cascadeClosure();
    for (const name of await workspaceIdTables()) {
      expect(
        closure,
        `${name} has workspace_id but no ON DELETE CASCADE path from workspace`,
      ).toContain(name);
    }
  });
});
