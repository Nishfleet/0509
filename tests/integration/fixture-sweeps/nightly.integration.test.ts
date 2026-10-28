import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readDiscoverableWorkspaces } from "../../../app/lib/data/entity.server";
import { readReconcilablePlans } from "../../../app/lib/data/plan.server";
import { stampFirstSignals } from "../../../app/lib/data/onboarding_run.server";
import { backfillSlackTargets } from "../../../app/lib/data/send_target.server";
import { loadNightlyPlan } from "../../../workers/standing/rollover-plan";
import { LONG_AGO, NOW, resetWorld, seedChangeSignals, seedPair } from "./seed";

const HOOK = "https://hooks.slack.com/services/T0123ABC/B0456DEF/abcDEF123456";

describe("nightly jobs skip fixture workspaces (0509#5774)", () => {
  beforeEach(resetWorld);

  it("schedules the weekly rollover and the discovery workflow for the live workspace only", async () => {
    const { live } = await seedPair();

    const plan = await loadNightlyPlan(env.DB, new Date(NOW));
    const discoverable = await readDiscoverableWorkspaces();

    expect(plan.workspaces).toBe(1);
    expect(discoverable.map((workspace) => workspace.workspaceId)).toEqual([live.workspaceId]);
  });

  it("reconciles the live workspace's subscription and not the fixture's", async () => {
    const { live } = await seedPair();

    const plans = await readReconcilablePlans(10, LONG_AGO);

    expect(plans.map((plan) => plan.subscriptionId)).toEqual([live.subscriptionId]);
  });

  it("stamps the first signal on a live onboarding only", async () => {
    const pair = await seedPair();
    await seedChangeSignals(pair);
    await env.DB.batch(
      [pair.live, pair.fixture].map((seeded) =>
        env.DB.prepare(
          "INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at) VALUES (?, ?, ?, 'example.com', ?)",
        ).bind(`run-${seeded.tag}`, seeded.workspaceId, seeded.userId, LONG_AGO),
      ),
    );

    await stampFirstSignals();

    const stamped = await env.DB.prepare(
      "SELECT workspace_id FROM onboarding_run WHERE first_signal_at IS NOT NULL",
    ).all<{
      workspace_id: string;
    }>();
    expect(stamped.results.map((row) => row.workspace_id)).toEqual([pair.live.workspaceId]);
  });

  it("seals the live workspace's Slack webhook and leaves the fixture's alone", async () => {
    const pair = await seedPair();
    await env.DB.batch(
      [pair.live, pair.fixture].map((seeded) =>
        env.DB.prepare(
          `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
           VALUES (?, ?, 'chan-slack', ?, 1, ?)`,
        ).bind(`slack-${seeded.tag}`, seeded.workspaceId, HOOK, NOW),
      ),
    );

    const result = await backfillSlackTargets(env.DB);

    expect(result).toEqual({ sealed: 1, skipped: 0, failed: 0 });
    const left = await env.DB.prepare("SELECT workspace_id FROM send_target WHERE target_value = ?")
      .bind(HOOK)
      .all<{ workspace_id: string }>();
    expect(left.results.map((row) => row.workspace_id)).toEqual([pair.fixture.workspaceId]);
  });
});
