import { describe, expect, it } from "vitest";

import { LOST_CHANNEL_REASON, NO_CHANNEL_REASON } from "../app/lib/mentions/channel-reasons";
import { plainSourceReason } from "../app/lib/source-status-words";

describe("plainSourceReason", () => {
  it("maps each known reason to its plain words", () => {
    expect(plainSourceReason("no fresh data")).toBe("no new data yet");
    expect(plainSourceReason("timed out")).toBe("slow to answer");
    expect(plainSourceReason("not answering")).toBe("not answering right now");
  });

  it("reads a blocked reason as not answering right now", () => {
    expect(plainSourceReason("blocked: 403")).toBe("not answering right now");
    expect(plainSourceReason("Blocked:cloudflare")).toBe("not answering right now");
  });

  it("matches ignoring case and surrounding whitespace", () => {
    expect(plainSourceReason("  TIMED OUT ")).toBe("slow to answer");
  });

  it("maps the channel reasons to plain words", () => {
    expect(plainSourceReason(LOST_CHANNEL_REASON)).toBe("finding the channel again");
    expect(plainSourceReason(NO_CHANNEL_REASON)).toBe("no YouTube channel on your profile");
  });

  it("falls back to not updating right now", () => {
    expect(plainSourceReason(null)).toBe("not updating right now");
    expect(plainSourceReason("")).toBe("not updating right now");
    expect(plainSourceReason("watch config is unreadable")).toBe("not updating right now");
  });
});
