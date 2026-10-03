import { describe, expect, it } from "vitest";

import type { BriefPayload } from "../app/lib/brief-payload";
import { resolveOpenId } from "../app/lib/home-page.server";

const ENTITIES = [{ id: "ent_self" }, { id: "ent_kindred" }];
const PAYLOAD: BriefPayload = { period_start: "2026-09-14T07:00:00.000Z" } as unknown as BriefPayload;

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
