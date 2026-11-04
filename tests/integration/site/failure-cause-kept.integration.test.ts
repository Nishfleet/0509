import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { recordPageFailure } from "../../../app/lib/data/page.server";

const SWEEP = "2026-10-16T21:00:16.637Z";
const LATER_SWEEP = "2026-10-17T21:00:12.000Z";
const USER = "user-failure-cause";
const WS = "ws-failure-cause";
const ENTITY = "ent-failure-cause";
const PAGE = "page-failure-cause";
const REFUSED = "deferred: browser budget refused escalation (thin-text)";
const REAL = "escalation-failed";

async function reason(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT last_failure_reason AS reason FROM page WHERE id = ?1").bind(PAGE).first();
  return row?.reason;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM entity WHERE workspace_id = ?1").bind(WS),
    env.DB.prepare("DELETE FROM workspace WHERE id = ?1").bind(WS),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(USER),
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 0, ?4, ?4)',
    ).bind(USER, "Owner", `${USER}@0509.io`, SWEEP),
    env.DB.prepare("INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)").bind(
      WS,
      USER,
      SWEEP,
    ),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at) VALUES (?1, ?2, 'competitor', 'blocked.example', 'B', '{}', 'auto', 'on', ?3)",
    ).bind(ENTITY, WS, SWEEP),
    env.DB.prepare(
      "INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES (?1, ?2, 'https://blocked.example/', 'home', ?3)",
    ).bind(PAGE, ENTITY, SWEEP),
  ]);
});

describe("the reason a page could not be read", () => {
  it("keeps the real cause when the recheck in the same sweep is refused by the budget", async () => {
    await recordPageFailure(PAGE, REAL, SWEEP);
    await recordPageFailure(PAGE, REFUSED, SWEEP);
    expect(await reason()).toBe(REAL);
  });

  it("takes a refusal on a later sweep, and a real cause over an old refusal", async () => {
    await recordPageFailure(PAGE, REAL, SWEEP);
    await recordPageFailure(PAGE, REFUSED, LATER_SWEEP);
    expect(await reason()).toBe(REFUSED);
    await recordPageFailure(PAGE, REAL, LATER_SWEEP);
    expect(await reason()).toBe(REAL);
  });

  it("records a refusal when nothing was recorded before", async () => {
    await recordPageFailure(PAGE, REFUSED, SWEEP);
    expect(await reason()).toBe(REFUSED);
  });
});
