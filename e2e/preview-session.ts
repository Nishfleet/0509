import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";

import { laneOrigin } from "./inbox";

export function devVar(name: string): string {
  const line = readFileSync(".dev.vars.example", "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(`${name}=`));
  if (line === undefined || line.length <= name.length + 1) throw new Error(`${name} missing from .dev.vars.example`);
  return line.slice(name.length + 1);
}

function previewDatabasePath(): string {
  const root = ".wrangler/state";
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".sqlite"));
  for (const name of files) {
    const file = join(root, name);
    const probe = new DatabaseSync(file, { readOnly: true, timeout: 15_000 });
    try {
      const row = probe.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'entity'").get();
      if (row !== undefined) return file;
    } finally {
      probe.close();
    }
  }
  throw new Error("local preview D1 has no entity table");
}

export async function seedPreviewWorkspace(label: string, competitors: number): Promise<{ cookie: string; workspaceId: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `${label}-${suffix}@0509.io`;
  const db = new DatabaseSync(previewDatabasePath(), { timeout: 15_000 });
  db.exec("PRAGMA busy_timeout = 15000");
  db.exec("PRAGMA foreign_keys = ON");
  const links: string[] = [];
  const auth = betterAuth({
    database: db,
    secret: devVar("BETTER_AUTH_SECRET"),
    baseURL: laneOrigin(),
    advanced: { cookiePrefix: "better-auth" },
    plugins: [
      magicLink({
        expiresIn: 300,
        sendMagicLink: ({ url }) => {
          links.push(url);
          return Promise.resolve();
        },
      }),
    ],
  });
  try {
    await auth.api.signInMagicLink({ body: { email }, headers: new Headers() });
    const link = links.at(-1);
    if (link === undefined) throw new Error("magic link was not issued");
    const response = await auth.handler(new Request(link, { redirect: "manual" }));
    const cookie = response.headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; ");
    if (cookie === "") throw new Error("magic link created no session cookie");
    const user = db.prepare('SELECT id FROM "user" WHERE email = ?').get(email) as { id: string } | undefined;
    if (user === undefined) throw new Error("magic link created no user");
    const stamp = "2026-09-27T00:00:00.000Z";
    const workspaceId = `ws-${suffix}`;
    db.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    ).run(workspaceId, label, user.id, stamp);
    db.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
    ).run(`ent-self-${suffix}`, workspaceId, `self-${suffix}.example`, stamp);
    for (let index = 0; index < competitors; index += 1) {
      db.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'competitor', ?, ?, ?)",
      ).run(`ent-${suffix}-${String(index)}`, workspaceId, `rival${String(index)}-${suffix}.example`, `Rival ${String(index)}`, stamp);
    }
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    return { cookie, workspaceId };
  } finally {
    db.close();
  }
}
