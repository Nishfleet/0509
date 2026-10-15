import { describe, expect, it } from "vitest";

import { LOST_CHANNEL_REASON, NO_CHANNEL_REASON } from "../app/lib/mentions/channel-reasons";
import { plainSourceReason } from "../app/lib/source-status-words";

describe("channel reason strings a customer never reads raw", () => {
  it("keeps the two stored reasons pinned to the exact strings the map keys on", () => {
    expect(LOST_CHANNEL_REASON).toBe("we lost the channel, re-resolving");
    expect(NO_CHANNEL_REASON).toBe("no YouTube channel on the confirmed card");
  });

  it("keeps the two reasons different and free of the blocked prefix", () => {
    expect(LOST_CHANNEL_REASON).not.toBe(NO_CHANNEL_REASON);
    expect(LOST_CHANNEL_REASON.startsWith("blocked:")).toBe(false);
    expect(NO_CHANNEL_REASON.startsWith("blocked:")).toBe(false);
  });

  it("rewords each stored reason into its own plain words, never the generic fallback", () => {
    expect(plainSourceReason(LOST_CHANNEL_REASON)).toBe("finding the channel again");
    expect(plainSourceReason(NO_CHANNEL_REASON)).toBe("no YouTube channel on your profile");
    expect(plainSourceReason(LOST_CHANNEL_REASON)).not.toBe("not updating right now");
    expect(plainSourceReason(NO_CHANNEL_REASON)).not.toBe("not updating right now");
  });
});
