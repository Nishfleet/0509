import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { SENDABLE_SIGNALS, SHOWN_SIGNALS } from "../../app/lib/customer-ready";

const NOW = "2026-10-15T12:00:00.000Z";
const WS = "ws-gate";
const ENTITY = "gate-rival";
const SOURCE = "gate-src";

const CAPTURED = JSON.stringify({ before: { textKey: "b.txt" }, after: { textKey: "a.txt" } });

interface SignalFields {
  kind: "mention" | "change" | "hiring" | "content";
  title?: string | null;
  url?: string | null;
  payload?: string;
  state?: "judged" | "unjudged";
  tombstoned?: boolean;
  duplicateOf?: string;
}

async function seedBase(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u-gate', 'Owner', 'u-gate@0509.io', 1, ?1, ?1)`,
  )
    .bind(NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'gate', 'u-gate', 'UTC', 1, 8, ?2)`,
  )
    .bind(WS, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', 'rival.example', 'Rival', 'on', ?3)`,
  )
    .bind(ENTITY, WS, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES (?1, 'gate-key', 'site', 'web', 'site.web', 'best_effort', 1, '{}')`,
  )
    .bind(SOURCE)
    .run();
}

async function seedSignal(id: string, fields: SignalFields): Promise<void> {
  const mention = fields.kind === "mention";
  await env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, aspect, payload_json, dedup_key, observed_at, state, is_tombstoned, duplicate_of)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
  )
    .bind(
      id,
      WS,
      ENTITY,
      SOURCE,
      fields.kind,
      fields.title === undefined ? `title ${id}` : fields.title,
      fields.url === undefined ? `https://rival.example/${id}` : fields.url,
      mention ? `https://rival.example/${id}` : null,
      mention ? `hash-${id}` : null,
      fields.kind === "change" ? "pricing" : null,
      fields.payload ?? "{}",
      `dedup-${id}`,
      NOW,
      mention ? (fields.state ?? "judged") : null,
      fields.tombstoned === true ? 1 : 0,
      fields.duplicateOf ?? null,
    )
    .run();
}

async function seedVerdict(
  signalId: string,
  questionId: string,
  p: number,
  choice: string | null = null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, choice, decided_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      `v-${signalId}-${questionId}`,
      WS,
      questionId,
      `h-${signalId}-${questionId}`,
      signalId,
      ENTITY,
      p,
      choice,
      NOW,
    )
    .run();
}

async function ids(source: string): Promise<string[]> {
  const { results } = await env.DB.prepare(`SELECT s.id AS id FROM ${source} s ORDER BY s.id`).all<{ id: string }>();
  return results.map((row) => row.id);
}

beforeEach(async () => {
  for (const table of ["jev_verdict", "signal", "source", "entity", "workspace", '"user"']) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }
  await seedBase();
});

describe("mentions", () => {
  it("shows only a mention judged about the brand, and sends only a confident one", async () => {
    await seedSignal("m-unjudged", { kind: "mention", state: "unjudged" });
    await seedSignal("m-no-verdict", { kind: "mention" });
    await seedSignal("m-low", { kind: "mention" });
    await seedVerdict("m-low", "mention_matters", 0.34);
    await seedSignal("m-keep", { kind: "mention" });
    await seedVerdict("m-keep", "mention_matters", 0.6);
    await seedSignal("m-act", { kind: "mention" });
    await seedVerdict("m-act", "mention_matters", 0.95);
    expect(await ids(SHOWN_SIGNALS)).toEqual(["m-act", "m-keep"]);
    expect(await ids(SENDABLE_SIGNALS)).toEqual(["m-act"]);
  });

  it("hides a mention that is withdrawn, a duplicate, or has no title or link", async () => {
    await seedSignal("m-ok", { kind: "mention" });
    await seedVerdict("m-ok", "mention_matters", 0.95);
    for (const [id, fields] of [
      ["m-tomb", { tombstoned: true }],
      ["m-dup", { duplicateOf: "m-ok" }],
      ["m-untitled", { title: null }],
    ] as const) {
      await seedSignal(id, { kind: "mention", ...fields });
      await seedVerdict(id, "mention_matters", 0.95);
    }
    expect(await ids(SHOWN_SIGNALS)).toEqual(["m-ok"]);
  });

  it("uses the newest verdict when a mention was judged twice", async () => {
    await seedSignal("m-rejudged", { kind: "mention" });
    await env.DB.prepare(
      `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES ('old', ?1, 'mention_matters', 'h-old', 'm-rejudged', 0.95, '2026-10-14T00:00:00.000Z'), ('new', ?1, 'mention_matters', 'h-new', 'm-rejudged', 0.2, '2026-10-15T00:00:00.000Z')`,
    )
      .bind(WS)
      .run();
    expect(await ids(SHOWN_SIGNALS)).toEqual([]);
  });
});

describe("changes", () => {
  it("hides a change nobody judged and a change with no captured pages", async () => {
    await seedSignal("c-unjudged", { kind: "change", payload: CAPTURED });
    await seedSignal("c-no-evidence", { kind: "change" });
    await seedVerdict("c-no-evidence", "noteworthy_change", 0.95);
    await seedSignal("c-half-evidence", {
      kind: "change",
      payload: JSON.stringify({ after: { textKey: "a.txt" } }),
    });
    await seedVerdict("c-half-evidence", "noteworthy_change", 0.95);
    expect(await ids(SHOWN_SIGNALS)).toEqual([]);
  });

  it("shows a judged change and sends only a noteworthy one", async () => {
    await seedSignal("c-set-aside", { kind: "change", payload: CAPTURED });
    await seedVerdict("c-set-aside", "noteworthy_change", 0.2);
    await seedSignal("c-noteworthy", { kind: "change", payload: CAPTURED });
    await seedVerdict("c-noteworthy", "noteworthy_change", 0.95);
    expect(await ids(SHOWN_SIGNALS)).toEqual(["c-noteworthy", "c-set-aside"]);
    expect(await ids(SENDABLE_SIGNALS)).toEqual(["c-noteworthy"]);
  });

  it("sends a pricing change at the lower pricing line", async () => {
    await seedSignal("c-pricing", { kind: "change", payload: CAPTURED });
    await seedVerdict("c-pricing", "noteworthy_change", 0.7);
    await seedVerdict("c-pricing", "change_kind", 0.9, "pricing");
    await seedSignal("c-copy", { kind: "change", payload: CAPTURED });
    await seedVerdict("c-copy", "noteworthy_change", 0.7);
    await seedVerdict("c-copy", "change_kind", 0.9, "copy");
    expect(await ids(SENDABLE_SIGNALS)).toEqual(["c-pricing"]);
  });

  it("treats a breakage verdict as judged only once it clears the line", async () => {
    await seedSignal("c-broken", { kind: "change", payload: CAPTURED });
    await seedVerdict("c-broken", "own_site_breakage", 0.05);
    await seedSignal("c-fine", { kind: "change", payload: CAPTURED });
    await seedVerdict("c-fine", "own_site_breakage", 0.8);
    expect(await ids(SHOWN_SIGNALS)).toEqual(["c-fine"]);
  });
});

describe("first-party kinds", () => {
  it("needs a captured title and link and shows them without a verdict", async () => {
    await seedSignal("h-ok", { kind: "hiring" });
    await seedSignal("h-no-link", { kind: "hiring", url: null });
    await seedSignal("p-ok", { kind: "content" });
    await seedSignal("p-untitled", { kind: "content", title: null });
    expect(await ids(SHOWN_SIGNALS)).toEqual(["h-ok", "p-ok"]);
    expect(await ids(SENDABLE_SIGNALS)).toEqual(["h-ok", "p-ok"]);
  });
});
