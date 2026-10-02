import { execFileSync } from "node:child_process";

export const log = (label: string, value: unknown) => console.log(`PROOF4012 ${label} ${JSON.stringify(value)}`);

export function d1(sql: string): Record<string, unknown>[] {
  if (!/^\s*(SELECT|PRAGMA foreign_keys\s*$)/i.test(sql)) throw new Error("read-only proof: SELECT only");
  let out: string;
  try {
    out = execFileSync("npx", ["wrangler", "d1", "execute", "0509", "--remote", "--json", "--command", sql], {
      encoding: "utf8",
      maxBuffer: 20_000_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    throw new Error(`D1 read failed: ${String(e.stderr ?? "").slice(0, 600)} ${String(e.stdout ?? "").slice(0, 600)}`, {
      cause: error,
    });
  }
  const parsed: { results: Record<string, unknown>[] }[] = JSON.parse(out);
  return parsed[0].results;
}

export const q = (ids: string[]) =>
  ids.length === 0 ? "NULL" : ids.map((id) => `'${id.replaceAll("'", "''")}'`).join(",");
const col = (rows: Record<string, unknown>[], key: string) => rows.map((row) => String(row[key]));

export interface Ids {
  email: string;
  userId: string;
  workspaceId: string;
  entities: string[];
  watches: string[];
  pages: string[];
  incidents: string[];
  wsTables: string[];
}

export function captureIds(email: string): Ids {
  const user = d1(`SELECT id FROM "user" WHERE email = '${email}'`);
  const userId = String(user[0]?.id ?? "");
  const workspace = d1(`SELECT id FROM workspace WHERE owner_user_id = '${userId}'`);
  const workspaceId = String(workspace[0]?.id ?? "");
  const entities = col(d1(`SELECT id FROM entity WHERE workspace_id = '${workspaceId}'`), "id");
  const watches = col(d1(`SELECT id FROM watch WHERE entity_id IN (${q(entities)})`), "id");
  const pages = col(d1(`SELECT id FROM page WHERE entity_id IN (${q(entities)})`), "id");
  const incidents = col(d1(`SELECT id FROM incident WHERE workspace_id = '${workspaceId}'`), "id");
  const wsTables = col(
    d1(
      `SELECT m.name AS name FROM sqlite_master m JOIN pragma_table_info(m.name) c WHERE m.type = 'table' AND c.name = 'workspace_id' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%' AND m.name NOT LIKE '%_hold' AND m.name <> 'd1_migrations' ORDER BY m.name`,
    ),
    "name",
  );
  return { email, userId, workspaceId, entities, watches, pages, incidents, wsTables };
}

export function counts(ids: Ids): Record<string, number> {
  const parts = [
    `SELECT 'user' AS t, COUNT(*) AS n FROM "user" WHERE id = '${ids.userId}'`,
    `SELECT 'session', COUNT(*) FROM session WHERE userId = '${ids.userId}'`,
    `SELECT 'account', COUNT(*) FROM account WHERE userId = '${ids.userId}'`,
    `SELECT 'apikey', COUNT(*) FROM apikey WHERE referenceId = '${ids.userId}'`,
    `SELECT 'passkey', COUNT(*) FROM passkey WHERE userId = '${ids.userId}'`,
    `SELECT 'workspace', COUNT(*) FROM workspace WHERE id = '${ids.workspaceId}'`,
    ...ids.wsTables.map((t) => `SELECT '${t}', COUNT(*) FROM ${t} WHERE workspace_id = '${ids.workspaceId}'`),
    `SELECT 'watch', COUNT(*) FROM watch WHERE entity_id IN (${q(ids.entities)}) OR id IN (${q(ids.watches)})`,
    `SELECT 'page', COUNT(*) FROM page WHERE entity_id IN (${q(ids.entities)}) OR id IN (${q(ids.pages)})`,
    `SELECT 'snapshot', COUNT(*) FROM snapshot WHERE watch_id IN (${q(ids.watches)})`,
    `SELECT 'incident_notice', COUNT(*) FROM incident_notice WHERE incident_id IN (${q(ids.incidents)}) OR page_id IN (${q(ids.pages)})`,
    `SELECT 'email_suppression(address)', COUNT(*) FROM email_suppression WHERE address = '${ids.email}'`,
  ];
  try {
    const rows = d1(parts.join(" UNION ALL "));
    return Object.fromEntries(rows.map((row) => [String(row.t), Number(row.n)]));
  } catch (error) {
    log("combined count query failed; falling back to one query per table", String(error).slice(0, 800));
  }
  const result: Record<string, number> = {};
  for (const part of parts) {
    const label = /SELECT '([^']+)'/.exec(part)?.[1] ?? part.slice(0, 40);
    try {
      const rows = d1(part);
      result[label] = Number(Object.values(rows[0] ?? { n: -1 })[Object.keys(rows[0] ?? { n: 0 }).length - 1]);
    } catch (error) {
      result[label] = -1;
      log(`count query failed for ${label}`, String(error).slice(0, 400));
    }
  }
  return result;
}

export function messageHeaders(raw: string) {
  const pick = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, "im").exec(raw)?.[1]?.trim() ?? null;
  return { messageId: pick("Message-ID"), date: pick("Date"), subject: pick("Subject") };
}
