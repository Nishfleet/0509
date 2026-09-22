import { describe, expect, it } from "vitest";

import { applyDeliveryRules } from "../../workers/delivery/brief-data";
import {
  digestIdempotencyKey,
  incidentIdempotencyKey,
  isStalePending,
  jobFromIdempotencyKey,
  quotedSignalIds,
} from "../../workers/delivery/record";

import type { BriefPayload } from "../../workers/delivery/brief-data";

function payload(): BriefPayload {
  return {
    headline: { rank: 1, of: 4, movement: 0, why: "Kept." },
    read_this_first: [
      {
        signal_id: "sig-week-1",
        entity_id: "brand-a",
        source: "site",
        observed_at: "2026-09-21T15:00:00.000Z",
        thumbnail_url: null,
        link: "https://brand.example/a",
        title: "Pricing page changed",
      },
      {
        signal_id: "sig-new",
        entity_id: "brand-a",
        source: "site",
        observed_at: "2026-09-22T15:00:00.000Z",
        thumbnail_url: null,
        link: "https://brand.example/b",
        title: "Homepage changed",
      },
    ],
    brands: [],
    own_site: { items: [] },
    checked: [],
    next_brief_at: null,
    quiet: false,
  };
}

describe("delivered once", () => {
  it("drops a signal quoted last week and keeps a new one, in the original order", () => {
    const next = applyDeliveryRules(payload(), [{ id: "brand-a", state: "on" }], new Set(["sig-week-1"]));
    expect(quotedSignalIds(next.read_this_first)).toEqual(["sig-new"]);
    expect(next.read_this_first.map((mark) => mark.title)).toEqual(["Homepage changed"]);
  });

  it("uses stable idempotency keys", () => {
    expect(digestIdempotencyKey("dig-1", "target-1")).toBe("digest:dig-1:target-1");
    expect(incidentIdempotencyKey("inc-1", "open")).toBe("incident:inc-1:open");
    expect(incidentIdempotencyKey("inc-1", "fixed")).toBe("incident:inc-1:fixed");
    expect(jobFromIdempotencyKey("digest:dig-1:target-1")).toEqual({ digest_id: "dig-1" });
    expect(jobFromIdempotencyKey("incident:inc-1:fixed")).toEqual({ incident_id: "inc-1", resolution: true });
  });

  it("treats a pending attempt as stale after one hour", () => {
    const now = new Date("2026-09-22T12:00:00.000Z");
    expect(isStalePending("2026-09-22T11:30:00.000Z", now)).toBe(false);
    expect(isStalePending("2026-09-22T10:00:00.000Z", now)).toBe(true);
  });
});
