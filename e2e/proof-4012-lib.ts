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
  const parts: [string, string][] = [
    ["user", `SELECT COUNT(*) AS n FROM "user" WHERE id = '${ids.userId}'`],
    ["session", `SELECT COUNT(*) AS n FROM session WHERE userId = '${ids.userId}'`],
    ["account", `SELECT COUNT(*) AS n FROM account WHERE userId = '${ids.userId}'`],
    ["apikey", `SELECT COUNT(*) AS n FROM apikey WHERE referenceId = '${ids.userId}'`],
    ["passkey", `SELECT COUNT(*) AS n FROM passkey WHERE userId = '${ids.userId}'`],
    ["workspace", `SELECT COUNT(*) AS n FROM workspace WHERE id = '${ids.workspaceId}'`],
    ...ids.wsTables.map((t): [string, string] => [
      t,
      `SELECT COUNT(*) AS n FROM ${t} WHERE workspace_id = '${ids.workspaceId}'`,
    ]),
    ["watch", `SELECT COUNT(*) AS n FROM watch WHERE entity_id IN (${q(ids.entities)}) OR id IN (${q(ids.watches)})`],
    ["page", `SELECT COUNT(*) AS n FROM page WHERE entity_id IN (${q(ids.entities)}) OR id IN (${q(ids.pages)})`],
    ["snapshot", `SELECT COUNT(*) AS n FROM snapshot WHERE watch_id IN (${q(ids.watches)})`],
    [
      "incident_notice",
      `SELECT COUNT(*) AS n FROM incident_notice WHERE incident_id IN (${q(ids.incidents)}) OR page_id IN (${q(ids.pages)})`,
    ],
  ];
  const result: Record<string, number> = {};
  for (const [label, sql] of parts) {
    try {
      result[label] = Number(d1(sql)[0]?.n ?? -1);
    } catch (error) {
      result[label] = -1;
      log(`count query failed for ${label}`, String(error).slice(0, 400));
    }
  }
  return result;
}

const SECRET_SHAPE = /hooks\.slack\.com|https?:\/\/|webhook|xox[a-z]-/i;

export function suppressionRows(email: string): Record<string, unknown>[] {
  return d1(`SELECT address, reason, created_at FROM email_suppression WHERE address = '${email}'`);
}

export function digestRows(workspaceId: string): Record<string, unknown>[] {
  return d1(`SELECT status, COUNT(*) AS n FROM digest WHERE workspace_id = '${workspaceId}' GROUP BY status`);
}

export function pendingDigests(workspaceId: string): number {
  const rows = d1(`SELECT COUNT(*) AS n FROM digest WHERE workspace_id = '${workspaceId}' AND status = 'pending'`);
  return Number(rows[0]?.n ?? -1);
}

export function hasSecretShape(rows: Record<string, unknown>[]): boolean {
  return rows.some((row) => Object.values(row).some((value) => SECRET_SHAPE.test(String(value))));
}

export function messageHeaders(raw: string) {
  const pick = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, "im").exec(raw)?.[1]?.trim() ?? null;
  return { messageId: pick("Message-ID"), date: pick("Date"), subject: pick("Subject") };
}
