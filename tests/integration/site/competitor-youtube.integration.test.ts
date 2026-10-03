import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../app/lib/require-session.server", () => ({
  requireSession: () => Promise.resolve({ user: { id: "user-comp-youtube" } }),
  requireFreshSession: () => Promise.resolve({ user: { id: "user-comp-youtube" } }),
}));

import {
  YOUTUBE_LINK_ERROR,
  YOUTUBE_LINK_MAX,
  YOUTUBE_TOO_LONG_ERROR,
  YOUTUBE_VIDEO_ERROR,
} from "../../../app/lib/competitor-youtube";
import { saveCompetitorYoutube } from "../../../app/lib/competitor-youtube.server";
import { readCompetitorSocials } from "../../../app/lib/data/entity.server";
import { action } from "../../../app/routes/app.competitor";

const NOW = "2026-10-02T02:00:00Z";
const USER = "user-comp-youtube";
const WS = "ws-comp-youtube";
const OTHER_WS = "ws-comp-youtube-other";
const RIVAL = "ent-comp-youtube-rival";
const WATCH = "watch-comp-youtube";
const BROKEN = '{"noChannel":{"state":"degraded","reason":"x","at":"2026-10-01T00:00:00Z"}}';

async function watchConfig(): Promise<string> {
  const row = await env.DB.prepare("SELECT config_json FROM watch WHERE id = ?1")
    .bind(WATCH)
    .first<{ config_json: string }>();
  return row?.config_json ?? "";
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM watch WHERE id = ?1").bind(WATCH),
    env.DB.prepare("DELETE FROM entity WHERE workspace_id IN (?1, ?2)").bind(WS, OTHER_WS),
    env.DB.prepare("DELETE FROM workspace WHERE id IN (?1, ?2)").bind(WS, OTHER_WS),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(USER),
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 0, ?4, ?4)',
    ).bind(USER, "Owner", `${USER}@0509.io`, NOW),
    env.DB.prepare("INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)").bind(
      WS,
      USER,
      NOW,
    ),
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
       VALUES (?1, ?2, 'competitor', 'rival-shop.com', 'Rival', ?3, 'auto', 'on', ?4)`,
    ).bind(
      RIVAL,
      WS,
      JSON.stringify({
        socials: [
          { platform: "youtube", url: "https://www.youtube.com/watch?v=abc" },
          { platform: "instagram", url: "https://www.instagram.com/rival/" },
        ],
      }),
      NOW,
    ),
    env.DB.prepare(
      "INSERT INTO watch (id, entity_id, source_id, target_key, config_json, last_polled_at) VALUES (?1, ?2, 'src_mentions_youtube', 'yt', ?3, ?4)",
    ).bind(WATCH, RIVAL, BROKEN, NOW),
  ]);
});

describe("saveCompetitorYoutube", () => {
  it("replaces the channel, keeps other links and re-opens the channel lookup", async () => {
    const saved = await saveCompetitorYoutube(WS, RIVAL, "youtube.com/@rivalshop");
    expect(saved).toEqual({ ok: true });
    expect(await readCompetitorSocials(WS, RIVAL)).toEqual([
      { platform: "instagram", url: "https://www.instagram.com/rival/" },
      { platform: "youtube", url: "https://www.youtube.com/@rivalshop" },
    ]);
    expect(await watchConfig()).toBe("{}");
    const polled = await env.DB.prepare("SELECT last_polled_at FROM watch WHERE id = ?1")
      .bind(WATCH)
      .first<{ last_polled_at: string | null }>();
    expect(polled?.last_polled_at).toBeNull();
  });

  it("refuses a link that is not a YouTube channel and changes nothing", async () => {
    const saved = await saveCompetitorYoutube(WS, RIVAL, "https://example.com/@rivalshop");
    expect(saved).toEqual({ ok: false, message: YOUTUBE_LINK_ERROR });
    expect((await readCompetitorSocials(WS, RIVAL))?.[0]?.url).toBe("https://www.youtube.com/watch?v=abc");
    expect(await watchConfig()).toBe(BROKEN);
  });

  it.each([
    ["javascript:alert(1)", YOUTUBE_LINK_ERROR],
    ["data:text/html,<script>alert(1)</script>", YOUTUBE_LINK_ERROR],
    ["https://youtu.be/dQw4w9WgXcQ", YOUTUBE_VIDEO_ERROR],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", YOUTUBE_VIDEO_ERROR],
    ["youtube.com/shorts/abc", YOUTUBE_VIDEO_ERROR],
    [`youtube.com/@${"a".repeat(YOUTUBE_LINK_MAX)}`, YOUTUBE_TOO_LONG_ERROR],
  ])("refuses %s with a plain reason and changes nothing", async (input, message) => {
    expect(await saveCompetitorYoutube(WS, RIVAL, input)).toEqual({ ok: false, message });
    expect((await readCompetitorSocials(WS, RIVAL))?.[0]?.url).toBe("https://www.youtube.com/watch?v=abc");
    expect(await watchConfig()).toBe(BROKEN);
  });

  it("adds the channel when the card had no links at all", async () => {
    await env.DB.prepare("UPDATE entity SET identity_json = '{}' WHERE id = ?1").bind(RIVAL).run();
    expect(await saveCompetitorYoutube(WS, RIVAL, "https://www.youtube.com/@rivalshop")).toEqual({ ok: true });
    expect(await readCompetitorSocials(WS, RIVAL)).toEqual([
      { platform: "youtube", url: "https://www.youtube.com/@rivalshop" },
    ]);
  });

  it("leaves a card it cannot read alone and keeps the lookup flags", async () => {
    await env.DB.prepare("UPDATE entity SET identity_json = 'not json {' WHERE id = ?1").bind(RIVAL).run();
    const saved = await saveCompetitorYoutube(WS, RIVAL, "youtube.com/@rivalshop");
    expect(saved.ok).toBe(false);
    expect(await watchConfig()).toBe(BROKEN);
  });

  it("saves through the page's own action for the signed-in owner", async () => {
    const body = new FormData();
    body.set("intent", "youtube");
    body.set("youtube", "youtube.com/@rivalshop");
    const request = new Request(`https://0509.io/app/competitors/${RIVAL}`, { method: "POST", body });
    const args = { request, params: { entityId: RIVAL }, context: {} } as unknown as Parameters<typeof action>[0];
    expect(await action(args)).toMatchObject({ youtubeError: null });
    expect((await readCompetitorSocials(WS, RIVAL))?.at(-1)?.url).toBe("https://www.youtube.com/@rivalshop");

    body.set("youtube", "https://youtu.be/dQw4w9WgXcQ");
    expect(await action({ ...args, request: new Request(request.url, { method: "POST", body }) })).toMatchObject({
      youtubeError: YOUTUBE_VIDEO_ERROR,
    });
  });

  it("will not touch another workspace's competitor", async () => {
    const saved = await saveCompetitorYoutube(OTHER_WS, RIVAL, "youtube.com/@rivalshop");
    expect(saved.ok).toBe(false);
    expect((await readCompetitorSocials(WS, RIVAL))?.[0]?.url).toBe("https://www.youtube.com/watch?v=abc");
    expect(await watchConfig()).toBe(BROKEN);
  });
});
