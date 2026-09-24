import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { ADLIB_SOURCE_ID } from "../../../app/lib/data/adlib.server";
import { readOnboardingCompetitors } from "../../../app/lib/data/entity.server";
import { writeDiscoveryResults } from "../../../app/lib/data/suggestion.server";
import { enqueueMetaAdlib } from "../../../app/lib/discovery/meta-adlib-enqueue.server";
import { runMetaAdlib } from "../../../app/lib/discovery/meta-adlib-run.server";
import { storedMetaCandidates } from "../../../app/lib/discovery/meta-adlib-store.server";
import { shortlist } from "../../../app/lib/discovery/shortlist";

const ENQUEUE = new Date("2026-09-24T06:00:00.000Z");
const ARRIVAL = new Date("2026-09-24T06:00:07.000Z");

const PAGE = [
  '<script>{"ad_archive_id":"1035896478962196","page_name":"Alphalete Athletics"}</script>',
  '<script>{"pageName":"Lululemon","adArchiveID":"714074828146579"}</script>',
  '<script>{"ad_archive_id":"1847470879199109","page_name":"Gymshark"}</script>',
].join("");

const SEARCH_URL =
  "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=GB&media_type=all&search_type=keyword_unordered&q=gym%20apparel";

let runs = 0;

async function seedWorkspace(identityJson: string): Promise<string> {
  runs += 1;
  const userId = `user-adlib-${String(runs)}`;
  const workspaceId = `ws-adlib-${String(runs)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, ENQUEUE.toISOString()),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, ENQUEUE.toISOString()),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', 'gymshark.com', 'Gymshark', ?3, ?4)",
    ).bind(`${workspaceId}-self`, workspaceId, identityJson, ENQUEUE.toISOString()),
  ]);
  return workspaceId;
}

describe("meta ad library generator", () => {
  it("lands after the competitor list is already written, then folds in on the next read", async () => {
    const workspaceId = await seedWorkspace(
      JSON.stringify({ description: "Gym clothing", category: "gym apparel", market: "GB" }),
    );
    const source = await env.DB.prepare(
      "SELECT key, plugin_key, reliability, is_enabled FROM source WHERE id = ?",
    )
      .bind(ADLIB_SOURCE_ID)
      .first<{ key: string; plugin_key: string; reliability: string; is_enabled: number }>();
    expect(source).toEqual({
      key: "discovery.meta_adlib",
      plugin_key: "discovery.meta_adlib",
      reliability: "scraped_page",
      is_enabled: 1,
    });

    const enqueuedAt = await enqueueMetaAdlib(workspaceId, ENQUEUE);
    expect(enqueuedAt).toBe(ENQUEUE.toISOString());

    await writeDiscoveryResults(
      workspaceId,
      [
        {
          name: "Nike",
          domain: "nike.com",
          evidence: [{ sourceUrl: "https://www.glamour.co.uk", excerpt: "Gymshark and Nike", generator: "news" }],
          line: "Named alongside you by 1 publisher",
          verdict: { questionId: "is_competitor", inputHash: `hash-${workspaceId}`, p: 0.9, cached: false },
        },
      ],
      enqueuedAt,
    );
    const rendered = await readOnboardingCompetitors(workspaceId);
    expect(rendered.on.map((row) => row.domain)).toEqual(["nike.com"]);
    const before = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM snapshot sn
       JOIN watch w ON w.id = sn.watch_id
       JOIN entity e ON e.id = w.entity_id
       WHERE e.workspace_id = ?`,
    )
      .bind(workspaceId)
      .first<{ n: number }>();
    expect(before?.n).toBe(0);

    let pulls = 0;
    const arrival = await runMetaAdlib({
      workspaceId,
      enqueuedAt,
      now: ARRIVAL,
      pull: () => {
        pulls += 1;
        return Promise.resolve({ status: 200, html: PAGE, searchUrl: SEARCH_URL });
      },
    });
    const again = await runMetaAdlib({
      workspaceId,
      enqueuedAt,
      now: new Date("2026-09-24T06:00:30.000Z"),
      pull: () => {
        pulls += 1;
        return Promise.resolve({ status: 200, html: PAGE, searchUrl: SEARCH_URL });
      },
    });

    expect(pulls).toBe(1);
    expect(arrival).toMatchObject({
      snapshotId: `adlib-${workspaceId}-${enqueuedAt}`,
      fetchedAt: ARRIVAL.toISOString(),
      enqueuedAt,
      skipped: false,
    });
    expect(again?.skipped).toBe(true);
    expect(arrival?.candidates.map((candidate) => candidate.name)).toEqual(["Alphalete Athletics", "Lululemon"]);
    expect(arrival?.candidates[0]?.evidence[0]).toEqual({
      sourceUrl: "https://www.facebook.com/ads/library/?id=1035896478962196",
      excerpt: "Alphalete Athletics advertises in GB for gym apparel",
      generator: "ads",
    });

    const suggestion = await env.DB.prepare("SELECT created_at FROM suggestion WHERE workspace_id = ?")
      .bind(workspaceId)
      .first<{ created_at: string }>();
    const snapshot = await env.DB.prepare(
      "SELECT id, fetched_at, item_count, payload_r2_key, payload_hash FROM snapshot WHERE id = ?",
    )
      .bind(arrival?.snapshotId)
      .first<{ id: string; fetched_at: string; item_count: number; payload_r2_key: string; payload_hash: string }>();
    expect(snapshot?.id).toBe(arrival?.snapshotId);
    expect(snapshot?.item_count).toBe(2);
    expect(snapshot?.payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(suggestion?.created_at < (snapshot?.fetched_at ?? "")).toBe(true);

    const watch = await env.DB.prepare(
      "SELECT target_key FROM watch WHERE entity_id = ? AND source_id = ?",
    )
      .bind(`${workspaceId}-self`, ADLIB_SOURCE_ID)
      .first<{ target_key: string }>();
    expect(watch?.target_key).toBe("gym apparel|GB");

    const stored = snapshot?.payload_r2_key ? await env.SNAPSHOTS.get(snapshot.payload_r2_key) : null;
    const payload = stored === null ? null : ((await stored.json()) as { searchUrl: string });
    expect(payload?.searchUrl).toBe(SEARCH_URL);
    const html = await env.SNAPSHOTS.get(`snapshot/discovery/${arrival?.snapshotId ?? ""}.html`);
    expect(await html?.text()).toContain("Alphalete Athletics");

    const still = await readOnboardingCompetitors(workspaceId);
    expect(still.on.map((row) => row.domain)).toEqual(["nike.com"]);
    expect(still.maybes).toEqual([]);

    const folded = await storedMetaCandidates(workspaceId);
    expect(folded.map((candidate) => candidate.name)).toEqual(["Alphalete Athletics", "Lululemon"]);
    expect(shortlist(folded).some((entry) => entry.generators.includes("ads"))).toBe(true);
  });

  it("records an empty snapshot and does not open a browser when the card has no category", async () => {
    const workspaceId = await seedWorkspace("{}");
    const enqueuedAt = await enqueueMetaAdlib(workspaceId, ENQUEUE);
    let pulls = 0;
    const arrival = await runMetaAdlib({
      workspaceId,
      enqueuedAt,
      now: ARRIVAL,
      pull: () => {
        pulls += 1;
        return Promise.resolve({ status: 200, html: PAGE, searchUrl: SEARCH_URL });
      },
    });
    expect(pulls).toBe(0);
    expect(arrival?.candidates).toEqual([]);
    const snapshot = await env.DB.prepare("SELECT item_count, fetched_at FROM snapshot WHERE id = ?")
      .bind(arrival?.snapshotId)
      .first<{ item_count: number; fetched_at: string }>();
    expect(snapshot).toEqual({ item_count: 0, fetched_at: ARRIVAL.toISOString() });
    const watch = await env.DB.prepare("SELECT target_key FROM watch WHERE entity_id = ?")
      .bind(`${workspaceId}-self`)
      .first<{ target_key: string }>();
    expect(watch?.target_key).toBe("unspecified");
  });

  it("records a blocked library page without retrying the browser", async () => {
    const workspaceId = await seedWorkspace(JSON.stringify({ category: "gym apparel", market: "GB" }));
    const enqueuedAt = await enqueueMetaAdlib(workspaceId, ENQUEUE);
    let pulls = 0;
    const arrival = await runMetaAdlib({
      workspaceId,
      enqueuedAt,
      now: ARRIVAL,
      pull: () => {
        pulls += 1;
        return Promise.resolve({
          status: 403,
          html: "fetch('/__rd_verify_challenge')",
          searchUrl: SEARCH_URL,
        });
      },
    });
    expect(pulls).toBe(1);
    expect(arrival?.candidates).toEqual([]);
    const snapshot = await env.DB.prepare("SELECT item_count FROM snapshot WHERE id = ?")
      .bind(arrival?.snapshotId)
      .first<{ item_count: number }>();
    expect(snapshot?.item_count).toBe(0);
  });
});
