import { describe, expect, it } from "vitest";

import { YOUTUBE_DAILY_SEARCH_CAP, youtubeConnector } from "~/lib/presence-connectors/youtube.server";
import { upsertPollCursor } from "~/lib/presence-data.server";

import { ISO_T0, seedUser } from "./fixtures";
import {
  closeOtherYoutubeWindows,
  EMPTY_PAGE,
  makeYoutubeCtx,
  makeYoutubeEnv,
  readYoutubeCursorJson,
  SEARCH_PAGE,
  seedYoutubeTarget,
  sumOpenYoutubeUsage,
  VIDEO_B_PUBLISHED_AT,
  youtubeFetcher,
} from "./youtube-fixtures";

/**
 * YouTube mention connector — the rate-budget contract (Nishfleet/0509#3203).
 *
 * The documented default allocation of 100 search.list calls/day
 * (developers.google.com/youtube/v3/determine_quota_cost — "Daily quotas
 * reset at midnight Pacific Time (PT)") is a COUNT of calls, shared by
 * EVERY tracked brand (one Google project = one key = one principal). The
 * connector deliberately overcounts that boundary with a rolling-24h usage
 * window in presence_poll_cursor.cursor_json, summed across every youtube
 * target — a closed window (>24h) does not count.
 *
 * Local storage is isolated per test FILE: this suite's usage accounting
 * only sees rows this file seeded, and its own earlier its are the "other
 * workspace" traffic the shared principal must account for.
 */

describe("youtube mention connector — rate budget (the documented 100 search.list calls/day, shared by every tracked brand)", () => {
  it("opens the window on one poll, enforces the cap from the SUM across targets, and counts the refused nothing", async () => {
    // Two targets, one per user — the connector treats them as ONE principal
    // (one Google project = one key), because the documented 100 calls/day
    // allocation is per Google project, not per workspace.
    const targetA = await seedYoutubeTarget();
    const otherUserId = await seedUser();
    const targetB = await seedYoutubeTarget({ userId: otherUserId, phrase: "Fixture Dynamics" });

    // Everything this FILE persisted so far counts against the shared key.
    const priorUsage = await sumOpenYoutubeUsage();
    expect(priorUsage).toBeGreaterThanOrEqual(0);

    // Bank target A's window so the SUM sits at exactly the cap-1: this
    // poll is the last one the documented allocation can afford.
    const banked = YOUTUBE_DAILY_SEARCH_CAP - 1 - priorUsage;
    await upsertPollCursor(makeYoutubeEnv("ga"), targetA.id, {
      cursor: { youtubeUsage: { windowStart: new Date().toISOString(), count: banked } },
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });

    // (windowStart above is now-relative BY DESIGN — see sumOpenYoutubeUsage.)
    let calls = 0;
    const fetchImpl = youtubeFetcher(() => {
      calls += 1;
      return { body: SEARCH_PAGE };
    });

    // Poll 1: the SUM (banked + prior) = 99 < 100, so the call goes out —
    // and the READ enforces the shared total, not this target's own count
    // (this target's own banked window alone is below the cap whenever
    // priorUsage > 0; the OTHER targets' calls are what pushes it to 99).
    const first = await youtubeConnector.poll(makeYoutubeCtx(fetchImpl, "ga"), targetA);
    expect(first.ok).toBe(true);
    expect(calls).toBe(1);
    const firstUsage = (first.cursor as Record<string, unknown>)?.youtubeUsage as { count: number };
    expect(firstUsage.count).toBe(banked + 1);

    // Persist exactly the way the service does, then poll again: the SUM now
    // reads 100 — the connector must refuse WITHOUT a network call.
    await upsertPollCursor(makeYoutubeEnv("ga"), targetA.id, {
      cursor: first.cursor,
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });
    const second = await youtubeConnector.poll(makeYoutubeCtx(fetchImpl, "ga"), targetA);
    expect(second.ok).toBe(false);
    expect(second.errorCode).toBe("youtube_daily_search_cap");
    expect(second.errorMessage).toContain("100");
    expect(calls).toBe(1); // the refused poll sent NOTHING

    // The shared principal: even a DIFFERENT workspace's target (different
    // user, its own row, its own prior usage of zero) is capped — one
    // Google project = one principal, exactly as documented.
    const third = await youtubeConnector.poll(makeYoutubeCtx(fetchImpl, "ga"), targetB);
    expect(third.ok).toBe(false);
    expect(third.errorCode).toBe("youtube_daily_search_cap");
    expect(calls).toBe(1); // nothing further was spent
  });

  it("a closed window's calls no longer count — the rolling 24h window rotates", async () => {
    const target = await seedYoutubeTarget();
    // The priors: earlier its' counted calls ride the SAME one-principal
    // window — rotate them closed first, so this its proves exactly the
    // closed-window math (its own banked-100 window vs a fresh poll).
    await closeOtherYoutubeWindows(target.id);
    // Seed a window whose windowStart is the fixture epoch (2026-01-01 —
    // months before this run): readUsageWindow finds it closed, its 100
    // counted calls no longer count, so the poll proceeds and the returned
    // window opens FRESH.
    await upsertPollCursor(makeYoutubeEnv("ga"), target.id, {
      cursor: { lastItemPublishedAt: VIDEO_B_PUBLISHED_AT, youtubeUsage: { windowStart: ISO_T0, count: YOUTUBE_DAILY_SEARCH_CAP } },
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });

    let calls = 0;
    let sawPublishedAfter: string | null = null;
    const fetchImpl = youtubeFetcher((url) => {
      calls += 1;
      sawPublishedAfter = url.searchParams.get("publishedAfter");
      return { body: EMPTY_PAGE };
    });

    const poll = await youtubeConnector.poll(makeYoutubeCtx(fetchImpl, "ga"), target, {
      record: await readYoutubeCursorJson(target.id),
    });
    expect(poll.ok).toBe(true);
    expect(calls).toBe(1); // the closed window did not block the poll
    // The prior watermark survived the rotation, and the fresh window
    // started counting THIS poll from one.
    expect(sawPublishedAfter).toBe(VIDEO_B_PUBLISHED_AT);
    expect((poll.cursor as Record<string, unknown>)?.youtubeUsage).toEqual({
      windowStart: expect.any(String),
      count: 1,
    });
  });
});
