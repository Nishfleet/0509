import { describe, expect, it } from "vitest";

import { LOST_CHANNEL_REASON, NO_CHANNEL_REASON } from "../app/lib/mentions/channel-reasons";
import type { SourceRow, SourceSnapshot } from "../app/lib/source-pill-status";
import { plainSourceReason, withoutNoDataYet } from "../app/lib/source-status-words";

describe("plainSourceReason", () => {
  it("maps each known reason to its plain words", () => {
    expect(plainSourceReason("no fresh data")).toBe("no new data yet");
    expect(plainSourceReason("timed out")).toBe("slow to answer");
    expect(plainSourceReason("not answering")).toBe("could not be checked right now");
  });

  it("reads a blocked reason as could not be checked right now", () => {
    expect(plainSourceReason("blocked: 403")).toBe("could not be checked right now");
    expect(plainSourceReason("Blocked:cloudflare")).toBe("could not be checked right now");
  });

  it("matches ignoring case and surrounding whitespace", () => {
    expect(plainSourceReason("  TIMED OUT ")).toBe("slow to answer");
  });

  it("maps the channel reasons to plain words", () => {
    expect(plainSourceReason(LOST_CHANNEL_REASON)).toBe("finding the channel again");
    expect(plainSourceReason(NO_CHANNEL_REASON)).toBe("no YouTube channel found");
  });

  it("falls back to not updating right now", () => {
    expect(plainSourceReason(null)).toBe("not updating right now");
    expect(plainSourceReason("")).toBe("not updating right now");
    expect(plainSourceReason("watch config is unreadable")).toBe("not updating right now");
  });
});

describe("withoutNoDataYet", () => {
  const NOW = Date.parse("2026-10-21T12:00:00.000Z");
  const live: SourceSnapshot = { item_count: 3, fetched_at: "2026-10-21T06:00:00.000Z", canary_count: 3 };

  function entry(key: string, overrides: Partial<SourceRow> = {}, snapshot: SourceSnapshot | null = null) {
    return { source: { key, platform: key, is_enabled: 1, ...overrides }, snapshot };
  }

  it("drops a source that has no data yet from the alerts list", () => {
    const kept = withoutNoDataYet([entry("news"), entry("hn"), entry("reddit", {}, live)], NOW);
    expect(kept.map((item) => item.source.key)).toEqual(["reddit"]);
  });

  it("keeps a source that is really failing, with its own reason", () => {
    const failing = entry("youtube", { degraded_reason: "timed out" });
    const quiet = entry("hn", {}, { ...live, item_count: 0 });
    expect(withoutNoDataYet([failing, quiet], NOW).map((item) => item.source.key)).toEqual(["youtube", "hn"]);
  });

  it("never leaves the words no new data yet in what it keeps", () => {
    const kept = withoutNoDataYet([entry("news"), entry("hn", { degraded_reason: "not answering" })], NOW);
    expect(kept.map((item) => item.source.key)).toEqual(["hn"]);
  });
});
