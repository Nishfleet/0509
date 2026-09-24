import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { BriefPayload } from "../../app/lib/brief-payload";
import { ensureWorkspaceForSignIn, firstWorkspaceId } from "../../app/lib/workspace.server";
import { deliver } from "../../workers/delivery/consumer";

const USER = "user-signin-target";
const ADDRESS = "owner@0509.io";
const WS = firstWorkspaceId(USER);

const brief: BriefPayload = {
  workspace_id: WS,
  timezone: "UTC",
  period_start: "2026-09-15T08:00:00.000Z",
  period_end: "2026-09-22T08:00:00.000Z",
  headline_rank: 1,
  headline_total: 2,
  headline_movement: 0,
  headline_is_new: false,
  why_line: "Quiet week: no site changes.",
  is_quiet_week: true,
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
  next_brief_at: "2026-09-29T08:00:00.000Z",
};

const sent: EmailMessageBuilder[] = [];
const recording: SendEmail = {
  send(message: EmailMessageBuilder) {
    sent.push(message);
    return Promise.resolve({} as EmailSendResult);
  },
};

const signIn = () =>
  ensureWorkspaceForSignIn(env.DB, {
    userId: USER,
    request: new Request("https://0509.io/api/auth/magic-link/verify"),
    now: "2026-09-22T00:00:00.000Z",
  });

describe("a new owner's sign-in is enough to receive the brief", () => {
  beforeEach(async () => {
    sent.length = 0;
    for (const table of ["send_attempt", "digest", "send_target", "email_suppression", "workspace", "channel"]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.exec(
      `INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-email', 'email', 1, '{}') ON CONFLICT(key) DO NOTHING`,
    );
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', ?, 1, '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
    )
      .bind(USER, ADDRESS)
      .run();
  });

  it("writes one email target for the owner's address, however many times they sign in", async () => {
    await signIn();
    await signIn();
    const { results } = await env.DB.prepare(
      `SELECT st.workspace_id, st.target_value, st.is_verified, c.key
         FROM send_target st JOIN channel c ON c.id = st.channel_id`,
    ).all();
    expect(results).toEqual([{ workspace_id: WS, target_value: ADDRESS, is_verified: 1, key: "email" }]);
  });

  it("the send lane then delivers the weekly brief to that address", async () => {
    await signIn();
    await env.DB.prepare(
      `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at)
       VALUES ('digest-signin', ?, 'weekly', '2026-09-15', '2026-09-22', 'pending', 'You are #1 of 2 this week', ?, NULL)`,
    )
      .bind(WS, JSON.stringify(brief))
      .run();

    const result = await deliver({ ...env, EMAIL: recording } as Env, { digest_id: "digest-signin" });

    expect(result.outcome).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(ADDRESS);
  });
});
