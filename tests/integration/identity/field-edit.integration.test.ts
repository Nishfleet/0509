import { env, introspectWorkflow } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { insertSelfEntity } from "../../../app/lib/data/entity.server";
import { insertFieldEdits, readEditedFields } from "../../../app/lib/data/user_decision.server";
import { confirmCard } from "../../../app/lib/identity/confirm.server";
import { normaliseSubject } from "../../../app/lib/identity/normalise";
import { probeKey } from "../../../app/lib/identity/probe-cache.server";

const NOW = "2026-09-25T10:30:00Z";
const FIELDS_VERDICT = "identity_field:edited";
const DOMAIN = "gymshark.com";
const HOMEPAGE_HTML = `<html><head><title>Gymshark</title></head><body>${"Gymshark makes gym clothes and sportswear for everyone. ".repeat(4)}</body></html>`;

let entityId = "";
let userId = "";
let workspaceId = "";

function subject() {
  const normalised = normaliseSubject(DOMAIN);
  if (!normalised.ok) throw new Error("gymshark.com must normalise");
  return normalised.subject;
}

function homepageKey(): string {
  return probeKey(subject(), "homepage");
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(async () => {
  await env.IDENTITY_CACHE.delete(homepageKey());
  for (const table of ["user_decision", "entity", "workspace", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  const suffix = crypto.randomUUID();
  entityId = `entity-field-edit-${suffix}`;
  userId = `user-field-edit-${suffix}`;
  workspaceId = `ws-field-edit-${suffix}`;
});

afterEach(async () => {
  vi.unstubAllGlobals();
});

async function seed(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Owner', ?2, 0, ?3, ?3)`,
  )
    .bind(userId, `${userId}@0509.io`, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)`,
  )
    .bind(workspaceId, userId, NOW)
    .run();
}

async function seedEntity(): Promise<void> {
  await seed();
  await insertSelfEntity({
    id: entityId,
    workspaceId,
    domain: DOMAIN,
    name: "Gymshark",
    identityJson: JSON.stringify({ description: null, socials: [] }),
    now: NOW,
  });
}

async function cachedHomepage(name: string, description: string): Promise<void> {
  await env.IDENTITY_CACHE.put(
    homepageKey(),
    JSON.stringify({
      name,
      description,
      socials: [],
      logoCandidates: { ldOrganizationLogo: null, ogImage: null, appleTouchIcon: null },
      adLibraryHints: [],
      navLinks: [],
    }),
  );
}

function stubWeb(html: string): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://gymshark.com/") return Promise.resolve(new Response(html, { status: 200, headers: { "content-type": "text/html" } }));
    return Promise.resolve(new Response("", { status: 200 }));
  });
}

async function settledTail(): Promise<void> {
  const row = await env.DB
    .prepare("SELECT id FROM entity WHERE workspace_id = ?1 AND role = 'self'")
    .bind(workspaceId)
    .first<{ id: string }>();
  if (row === null) return;
  const instance = await env.IDENTITY_TAIL.get(`identity-tail-${row.id}`);
  if (instance === null) return;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = await instance.status();
    if (status.status === "complete" || status.status === "errored") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("identity tail did not finish");
}

async function userDecisionsRow(): Promise<{
  verdict: string;
  note: string;
  workspace_id: string;
  user_id: string;
  entity_id: string;
} | null> {
  return await env.DB.prepare(
    "SELECT verdict, note, workspace_id, user_id, entity_id FROM user_decision WHERE entity_id = ?1",
  )
    .bind(entityId)
    .first<{ verdict: string; note: string; workspace_id: string; user_id: string; entity_id: string }>();
}

const fieldEditNoteSchema = z.object({
  field: z.enum(["name", "description"]),
  from: z.string().nullable(),
  to: z.string(),
});

async function confirmedEntityId(): Promise<string> {
  const row = await env.DB
    .prepare("SELECT id FROM entity WHERE workspace_id = ?1 AND role = 'self'")
    .bind(workspaceId)
    .first<{ id: string }>();
  if (row === null) throw new Error("confirmed entity was not stored");
  return row.id;
}

async function fieldEditRows(id: string): Promise<z.infer<typeof fieldEditNoteSchema>[]> {
  const { results } = await env.DB
    .prepare(
      "SELECT note FROM user_decision WHERE entity_id = ?1 AND verdict = ?2",
    )
    .bind(id, FIELDS_VERDICT)
    .all<{ note: string }>();
  return results.flatMap((row) => {
    const parsed = fieldEditNoteSchema.safeParse(JSON.parse(row.note));
    return parsed.success ? [parsed.data] : [];
  });
}

describe("field-edit records", () => {
  it("records one row per edited field with the JSON note shape", async () => {
    await seedEntity();

    await insertFieldEdits([
      {
        workspaceId,
        userId,
        entityId,
        edit: { field: "name", from: "Gymshark Ltd", to: "Gymshark" },
        decidedAt: NOW,
      },
    ]);

    expect(await readEditedFields(entityId)).toEqual(["name"]);
    const row = await userDecisionsRow();
    expect(row?.verdict).toBe(FIELDS_VERDICT);
    expect(JSON.parse(row?.note ?? "null")).toEqual({
      field: "name",
      from: "Gymshark Ltd",
      to: "Gymshark",
    });
    expect(row?.workspace_id).toBe(workspaceId);
    expect(row?.user_id).toBe(userId);
    expect(row?.entity_id).toBe(entityId);
  });

  it("returns empty when the entity has no field-edit rows", async () => {
    await seedEntity();

    expect(await readEditedFields(entityId)).toEqual([]);
  });

  it("ignores a row whose note is not JSON", async () => {
    await seedEntity();
    await env.DB.prepare(
      `INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at)
       VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7)`,
    )
      .bind(crypto.randomUUID(), workspaceId, userId, entityId, FIELDS_VERDICT, "not json", NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at)
       VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7)`,
    )
      .bind(
        crypto.randomUUID(),
        workspaceId,
        userId,
        entityId,
        FIELDS_VERDICT,
        JSON.stringify({ from: "a", to: "b" }),
        NOW,
      )
      .run();

    expect(await readEditedFields(entityId)).toEqual([]);
  });
});

describe("confirmCard field edits", () => {
  it("records one row per field the user changed away from the cached probe", async () => {
    await seed();
    await cachedHomepage("Gymshark Ltd", "Gym clothes");
    stubWeb(HOMEPAGE_HTML);

    expect(
      await confirmCard(
        workspaceId,
        userId,
        form({ subject: DOMAIN, name: "Gymshark", description: "Gym clothes for everyone" }),
      ),
    ).toBe(true);

    const rows = await fieldEditRows(await confirmedEntityId());
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { field: "name", from: "Gymshark Ltd", to: "Gymshark" },
        { field: "description", from: "Gym clothes", to: "Gym clothes for everyone" },
      ]),
    );
    await settledTail();
  });

  it("records only the field that changed", async () => {
    await seed();
    await cachedHomepage("Gymshark Ltd", "Gym clothes");
    stubWeb(HOMEPAGE_HTML);

    expect(
      await confirmCard(
        workspaceId,
        userId,
        form({ subject: DOMAIN, name: "Gymshark", description: "Gym clothes" }),
      ),
    ).toBe(true);

    expect(await fieldEditRows(await confirmedEntityId())).toEqual([
      { field: "name", from: "Gymshark Ltd", to: "Gymshark" },
    ]);
    await settledTail();
  });

  it("does not record a repeated confirm whose values the self entity writer discarded", async () => {
    await seed();
    await cachedHomepage("Gymshark Ltd", "Gym clothes");
    stubWeb(HOMEPAGE_HTML);

    expect(
      await confirmCard(
        workspaceId,
        userId,
        form({ subject: DOMAIN, name: "Gymshark", description: "Gym clothes" }),
      ),
    ).toBe(true);
    expect(
      await confirmCard(
        workspaceId,
        userId,
        form({ subject: DOMAIN, name: "Second", description: "Second description" }),
      ),
    ).toBe(true);

    expect(await fieldEditRows(await confirmedEntityId())).toEqual([
      { field: "name", from: "Gymshark Ltd", to: "Gymshark" },
    ]);
    await settledTail();
  });

  it("writes no rows when the homepage probe is not cached", async () => {
    await seed();
    stubWeb(HOMEPAGE_HTML);
    await using introspector = await introspectWorkflow(env.IDENTITY_TAIL);
    await introspector.modifyAll(async (modifier) => {
      await modifier.disableSleeps();
      for (let n = 1; n <= 24; n += 1) {
        await modifier.mockStepResult({ name: `site-fill-${String(n)}` }, "pending");
      }
    });

    expect(
      await confirmCard(
        workspaceId,
        userId,
        form({ subject: DOMAIN, name: "Gymshark", description: "Gym clothes" }),
      ),
    ).toBe(true);

    expect(await fieldEditRows(await confirmedEntityId())).toEqual([]);
    await settledTail();
  });
});
