import { env, type D1Migration } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const NOW = "2026-10-13T12:00:00.000Z";
const READ = "2026-10-08T21:05:00.000Z";

interface Card {
  id: string;
  role: "self" | "competitor";
  state: "on" | "off";
  identity: string;
  cleared: boolean;
}

const YOUTUBE = { platform: "youtube", url: "https://www.youtube.com/@brand" };
const INSTAGRAM = { platform: "instagram", url: "https://www.instagram.com/brand" };

const CARDS: Card[] = [
  {
    id: "empty-read",
    role: "competitor",
    state: "on",
    identity: JSON.stringify({ socials: [], socialsReadAt: READ }),
    cleared: true,
  },
  { id: "unread", role: "competitor", state: "on", identity: JSON.stringify({ socials: [] }), cleared: false },
  {
    id: "has-youtube",
    role: "competitor",
    state: "on",
    identity: JSON.stringify({ socials: [YOUTUBE], socialsReadAt: READ }),
    cleared: false,
  },
  {
    id: "has-other",
    role: "competitor",
    state: "on",
    identity: JSON.stringify({ socials: [INSTAGRAM], socialsReadAt: READ }),
    cleared: false,
  },
  {
    id: "paused",
    role: "competitor",
    state: "off",
    identity: JSON.stringify({ socials: [], socialsReadAt: READ }),
    cleared: false,
  },
  { id: "bad-json", role: "competitor", state: "on", identity: "not json", cleared: false },
  {
    id: "keeps-fields",
    role: "competitor",
    state: "on",
    identity: JSON.stringify({ name: "Keep", socials: [], socialsReadAt: READ }),
    cleared: true,
  },
];

function migrationUpdate(): string {
  const found: D1Migration | undefined = env.TEST_MIGRATIONS.find((migration) =>
    migration.name.endsWith("_reread_no_link_cards.sql"),
  );
  if (found === undefined) throw new Error("0056_reread_no_link_cards.sql is missing from TEST_MIGRATIONS");
  const updates = found.queries.filter((query) => /update\s+entity/i.test(query));
  if (updates.length !== 1) throw new Error(`0056 holds ${updates.length} UPDATEs over entity`);
  return updates[0] as string;
}

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO \"user\" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u-m56', 'm56', 'm56@example.com', 1, ?1, ?1)",
    ).bind(NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at, fixture) VALUES ('w-m56', 'm56', 'u-m56', 'UTC', 1, 8, ?1, 0)",
    ).bind(NOW),
    ...CARDS.map((card) =>
      env.DB.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, state, created_at) VALUES (?1, 'w-m56', ?2, ?3, ?1, ?4, ?5, ?6)",
      ).bind(card.id, card.role, `${card.id}.example.com`, card.identity, card.state, NOW),
    ),
  ]);
}

async function identities(): Promise<Map<string, string>> {
  const { results } = await env.DB.prepare("SELECT id, identity_json FROM entity WHERE workspace_id = 'w-m56'").all<{
    id: string;
    identity_json: string;
  }>();
  return new Map(results.map((row) => [row.id, row.identity_json]));
}

describe("the 0056 re-read UPDATE", () => {
  it("clears socialsReadAt only on active competitor cards with no socials at all, and nothing else", async () => {
    await seed();
    const update = migrationUpdate();
    await env.DB.prepare(update).run();
    await env.DB.prepare(update).run();

    const after = await identities();
    for (const card of CARDS) {
      const now = after.get(card.id);
      if (!card.cleared) {
        expect(now, card.id).toBe(card.identity);
        continue;
      }
      const expected: Record<string, unknown> = JSON.parse(card.identity);
      delete expected.socialsReadAt;
      expect(JSON.parse(now ?? "null"), card.id).toEqual(expected);
    }
  });
});
