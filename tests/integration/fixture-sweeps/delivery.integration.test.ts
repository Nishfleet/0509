import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readMonthlies } from "../../../app/lib/data/monthly.server";
import { readTrialRecaps } from "../../../app/lib/data/recap.server";
import { readRivalNudges } from "../../../app/lib/data/rival_nudge.server";
import { readTrialsEnding } from "../../../app/lib/data/trial_reminder.server";
import { readNewTrials } from "../../../app/lib/data/welcome.server";
import { readWinbacks } from "../../../app/lib/data/winback.server";
import { deliver } from "../../../workers/delivery/consumer";
import { sweepPending } from "../../../workers/delivery/sweeper";
import { NOW, resetWorld, seedPair } from "./seed";

const DAY_MS = 86_400_000;
const now = new Date(NOW);
const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY_MS).toISOString();

const setPlan = (periodEnd: string, trialing: number) =>
  env.DB.prepare("UPDATE plan SET current_period_end = ?, trialing = ?").bind(periodEnd, trialing).run();

const setWorkspace = (column: "last_seen_at" | "created_at", value: string) =>
  env.DB.prepare(`UPDATE workspace SET ${column} = ?`).bind(value).run();

interface LifecycleCase {
  name: string;
  prepare: () => Promise<unknown>;
  read: () => Promise<readonly { workspace_id: string }[]>;
}

const lifecycle: LifecycleCase[] = [
  { name: "welcome email", prepare: () => setPlan(daysFromNow(7), 1), read: () => readNewTrials(env.DB, now) },
  { name: "trial recap", prepare: () => setPlan(daysFromNow(2.5), 1), read: () => readTrialRecaps(env.DB, now) },
  { name: "trial reminder", prepare: () => setPlan(daysFromNow(1), 1), read: () => readTrialsEnding(env.DB, now) },
  {
    name: "winback email",
    prepare: async () => {
      await setPlan(daysFromNow(20), 0);
      await setWorkspace("last_seen_at", daysFromNow(-30));
    },
    read: () => readWinbacks(env.DB, now),
  },
  {
    name: "monthly email",
    prepare: async () => {
      await setPlan(daysFromNow(20), 0);
      await setWorkspace("last_seen_at", daysFromNow(-1));
    },
    read: () => readMonthlies(env.DB, now),
  },
  {
    name: "rival nudge",
    prepare: () => setWorkspace("created_at", daysFromNow(-7)),
    read: () => readRivalNudges(env.DB, now),
  },
];

const queueFor = (sent: unknown[]) =>
  ({
    sendBatch: (messages: { body: unknown }[]) => {
      sent.push(...messages.map((message) => message.body));
      return Promise.resolve();
    },
  }) as unknown as Queue;

describe("email lifecycle skips fixture workspaces (0509#5774)", () => {
  beforeEach(resetWorld);

  it.each(lifecycle)("selects the live workspace for the $name and not the fixture", async ({ prepare, read }) => {
    const { live } = await seedPair();
    await prepare();

    const rows = await read();

    expect(rows.map((row) => row.workspace_id)).toEqual([live.workspaceId]);
  });

  it("re-enqueues a stale pending digest for the live workspace only", async () => {
    const { live, fixture } = await seedPair();
    await env.DB.batch(
      [live, fixture].map((seeded) =>
        env.DB.prepare(
          `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json)
           VALUES (?, ?, 'weekly', '2026-09-28', '2026-10-04', 'pending', 'brief', '{}')`,
        ).bind(`digest-${seeded.tag}`, seeded.workspaceId),
      ),
    );
    const sent: unknown[] = [];

    await sweepPending({ ...env, SEND_EMAIL: queueFor(sent) } as Env, now);

    expect(sent).toEqual([{ digest_id: "digest-live" }]);
  });

  it("delivers a live workspace's digest and suppresses a fixture workspace's", async () => {
    const { live, fixture } = await seedPair();
    await env.DB.prepare("DELETE FROM send_target WHERE workspace_id = ?").bind(live.workspaceId).run();
    await env.DB.batch(
      [live, fixture].map((seeded) =>
        env.DB.prepare(
          `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json)
           VALUES (?, ?, 'weekly', '2026-09-28', '2026-10-04', 'pending', 'brief', '{}')`,
        ).bind(`digest-${seeded.tag}`, seeded.workspaceId),
      ),
    );

    const liveResult = await deliver(env, { digest_id: "digest-live" });
    const fixtureResult = await deliver(env, { digest_id: "digest-fixture" });

    expect(liveResult.outcome).toBe("no_target");
    expect(fixtureResult.outcome).toBe("suppressed");
  });
});
