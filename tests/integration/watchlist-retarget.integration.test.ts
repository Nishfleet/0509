import { describe, expect, it } from "vitest";

import { getWatchlistDeliveryConfig, upsertWatchlistDeliveryConfig } from "~/lib/data/watchlist-delivery-config.server";
import { updateWatchlist } from "~/lib/data/watchlists-core.server";

import { appEnv, seedUser, seedWatchlist } from "./fixtures";

/**
 * Retargeting a watchlist (a competitor rebrand or a domain change, i.e. a new
 * `targetFingerprint`) builds a replacement watchlist and copies the old
 * watchlist's delivery config onto it in `copyWatchlistDeliverySettings`.
 *
 * That copy is a hand-written `INSERT ... SELECT` that lists the columns it
 * carries. When 0019 added `slack_enabled` the copy was updated; when 0075
 * added `teams_enabled` it was not, so retargeting silently reset Teams alert
 * delivery to the schema default 0 while email and digest kept working.
 *
 * The `slack` case below is the control: it proves the copy path itself works,
 * so a `teams` failure is the column being dropped, not the retarget path
 * being skipped.
 */
describe("retargeting a watchlist", () => {
  it("carries teams_enabled onto the replacement delivery config", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId, undefined);

    await upsertWatchlistDeliveryConfig(appEnv, {
      watchlistId,
      userId,
      sensitivityMode: "balanced",
      instantEnabled: true,
      digestEnabled: true,
      emailEnabled: true,
      whatsappEnabled: false,
      slackEnabled: true,
      teamsEnabled: true,
    });

    const before = await getWatchlistDeliveryConfig(appEnv, watchlistId);
    expect(before?.teamsEnabled).toBe(true);
    expect(before?.slackEnabled).toBe(true);

    const replacement = await updateWatchlist(appEnv, userId, watchlistId, {
      name: "Fixture retargeted",
      targetType: "advertiser",
      targetId: `target_${watchlistId}`,
      targetFingerprint: "new-fp",
      targetLabel: "Label retargeted",
    });

    expect(replacement).not.toBeNull();
    expect(replacement?.id).not.toBe(watchlistId);

    const copied = await getWatchlistDeliveryConfig(appEnv, replacement!.id);
    expect(copied).not.toBeNull();
    // The control: slack was carried by the copy before any fix.
    expect(copied?.slackEnabled).toBe(true);
    // The defect: teams was dropped by the copy.
    expect(copied?.teamsEnabled).toBe(true);
    expect(copied?.instantEnabled).toBe(true);
    expect(copied?.emailEnabled).toBe(true);
  });
});
