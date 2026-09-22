import { describe, expect, it, vi } from "vitest";

import { parseBriefPayload } from "../../workers/delivery/brief-data";
import { d4PackSchema, hashPack, IMPORTANCE_LEVELS, type d4RequestBody } from "../../workers/jev/context-pack";
import { parseVerdict, postReadThisFirst, selectReadThisFirst, whyLineFor } from "../../workers/standing/read-this-first";
import { quietWeekLine } from "../../app/lib/standing-present";

const pack = d4PackSchema.parse({
  self: { name: "Self", domain: "self.example", state: "on", identity: {} },
  subject: { name: "Kindred", domain: "kindred.example", state: "on", identity: {} },
  competitor_set: [{ name: "Other", domain: "other.example" }],
  item: {
    signal_id: "sig-1",
    kind: "change",
    title: "Pricing moved",
    summary: null,
    url: "https://kindred.example/pricing",
    evidence_url: "https://shots.example/1.png",
    observed_at: "2026-09-22T12:00:00.000Z",
    source_key: "site.diff",
  },
  history_30d: [],
  user_memory: [],
});

describe("D4 read this first", () => {
  it("gates on the noul before ordering by importance and keeps three", () => {
    const chosen = selectReadThisFirst([
      { signalId: "low", p: 0.49, importance: 10, reason: "no", title: "no", evidenceUrl: null },
      { signalId: "a", p: 0.5, importance: 2, reason: "second", title: "A", evidenceUrl: null },
      { signalId: "b", p: 0.8, importance: 9, reason: "first", title: "B", evidenceUrl: null },
      { signalId: "c", p: 0.7, importance: 8, reason: "third", title: "C", evidenceUrl: null },
      { signalId: "d", p: 0.9, importance: 1, reason: "fourth", title: "D", evidenceUrl: null },
    ]);
    expect(chosen.map((item) => item.signalId)).toEqual(["b", "c", "a"]);
  });

  it("uses the counts line when nothing clears 0.5", () => {
    expect(quietWeekLine(61, 2, 0)).toBe("Quiet week: 61 mentions checked, 2 site changes, no new ads.");
    const why = whyLineFor([], { mentions: 61, siteChanges: 2, newAds: 0 }, false, false);
    expect(why).toEqual({
      line: "Quiet week: 61 mentions checked, 2 site changes, no new ads.",
      source: "counts",
    });
  });

  it("does not call a quiet week while a source canary is red", () => {
    const why = whyLineFor(
      [{ signalId: "a", p: 0.2, importance: 1, reason: null, title: null, evidenceUrl: null }],
      { mentions: 0, siteChanges: 0, newAds: 0 },
      true,
      false,
    );
    expect(why.source).toBe("degraded");
    expect(why.line).not.toMatch(/Quiet week/);
  });

  it("posts one boolean and one score in a single request", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            answers: {
              read_this_first: { type: "boolean", probability: 0.72, reason: "Pricing moved" },
              importance: { type: "score", score: 8 },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const verdict = await postReadThisFirst("https://jev.example/jev", "secret", pack, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body)) as ReturnType<typeof d4RequestBody>;
    expect(body).not.toHaveProperty("model");
    expect(body.questions.read_this_first.type).toBe("boolean");
    expect(body.questions.importance.type).toBe("score");
    expect(body.questions.importance.criteria).toHaveLength(IMPORTANCE_LEVELS.length);
    expect(IMPORTANCE_LEVELS).toHaveLength(10);
    expect(verdict).toEqual({ p: 0.72, importance: 8, reason: "Pricing moved" });
  });

  it("reads an SDK noul when probability is absent", () => {
    expect(
      parseVerdict({
        answers: {
          read_this_first: { type: "noul", noul: 0.4 },
          importance: { type: "score", score: 3 },
        },
      }),
    ).toEqual({ p: 0.4, importance: 3, reason: null });
  });

  it("hashes the same pack once, independent of key order", async () => {
    const first = await hashPack(pack);
    const second = await hashPack(
      d4PackSchema.parse({
        item: pack.item,
        user_memory: pack.user_memory,
        history_30d: pack.history_30d,
        competitor_set: pack.competitor_set,
        subject: pack.subject,
        self: pack.self,
      }),
    );
    expect(second).toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("writes a digest payload the brief reader accepts", () => {
    const payload = parseBriefPayload(
      JSON.stringify({
        workspace_id: "ws-1",
        timezone: "UTC",
        period_start: "2026-09-21T08:00:00.000Z",
        period_end: "2026-09-28T08:00:00.000Z",
        headline_rank: 1,
        headline_total: 4,
        headline_movement: 2,
        headline_is_new: false,
        why_line: "Pricing moved",
        is_quiet_week: false,
        read_this_first: [
          {
            signal_id: "sig-1",
            entity_id: "ent-b",
            entity_name: "Kindred",
            title: "Pricing moved",
            source: "site.diff",
            observed_at: "2026-09-22T12:00:00.000Z",
            url: "https://kindred.example/pricing",
            jev_reason: "Pricing moved",
          },
        ],
        brands: [{ entity_id: "ent-self", name: "Self", rank: 1, movement: 2, is_new: false }],
        own_site: { status: "ok", incidents: [] },
        checked: {
          mention_count: 1,
          site_change_count: 1,
          new_ad_count: 0,
          source_keys: ["google"],
          degraded_source_keys: [],
        },
        next_brief_at: "2026-09-28T08:00:00.000Z",
      }),
    );
    expect(payload.why_line).toBe("Pricing moved");
    expect(payload.is_quiet_week).toBe(false);
    expect(payload.read_this_first[0]?.jev_reason).toBe("Pricing moved");
    expect(payload.checked.mention_count).toBe(1);
  });
});
