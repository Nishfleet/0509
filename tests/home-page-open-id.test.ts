import { describe, expect, it } from "vitest";

import type { BriefPayload } from "../app/lib/brief-payload";
import { resolveOpenId } from "../app/lib/home-page.server";

const ENTITIES = [{ id: "ent_self" }, { id: "ent_kindred" }];
const PAYLOAD: BriefPayload = {
  workspace_id: "ws_1",
  timezone: "Europe/London",
  period_start: "2026-09-14T07:00:00.000Z",
  period_end: "2026-09-21T07:00:00.000Z",
  headline_rank: 2,
  headline_total: 3,
  headline_movement: 1,
  headline_is_new: false,
  why_line: "Kindred launched 3 new ads",
  is_quiet_week: false,
  is_unjudged: false,
  read_this_first: [],
  brands: [],
  own_site: { status: "ok", incidents: [] },
  checked: {
    mention_count: 0,
    site_change_count: 0,
    new_ad_count: 0,
    source_keys: [],
    degraded_source_keys: [],
    degraded_sources: [],
  },
  next_brief_at: null,
};

describe("resolveOpenId", () => {
  it("returns null when open is null", () => {
    expect(resolveOpenId(null, PAYLOAD, ENTITIES)).toBeNull();
  });

  it("returns null when payload is null even when open matches an entity", () => {
    expect(resolveOpenId("ent_self", null, ENTITIES)).toBeNull();
  });

  it("returns the entity id when open matches an entity", () => {
    expect(resolveOpenId("ent_self", PAYLOAD, ENTITIES)).toBe("ent_self");
  });

  it("returns null when open is not among the entities", () => {
    expect(resolveOpenId("ent_casetta", PAYLOAD, ENTITIES)).toBeNull();
  });
});
