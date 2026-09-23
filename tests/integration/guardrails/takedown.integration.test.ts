import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { fanOutTakedown } from "../../../workers/workflows/takedown";
import {
  RECONCILIATION_UTC_HOUR,
  reconcileUnfannedTakedowns,
  runNightlyReconciliation,
} from "../../../workers/standing/nightly";

/**
 * Engine 10 P10.2 (0509#3982) against real workerd, real local D1 with the real
 * migrations applied, and a real local R2 bucket.
 *
 * The Workflow class is driven with its own `run` and a step stub that executes
 * the callback inline, so the fan-out's SQL, ordering and idempotence are the
 * production code and the only thing replaced is the durable wrapper.
 *
 * Three rules the packet makes load-bearing are pinned here:
 *  - the dismissal is routed through `entity.state`, never a takedown check on
 *    a surface (asserted by reading the entity row, not by a helper);
 *  - a matching `role='self'` row is left at `state='on'` and the fact lands on
 *    `takedown.note` (the schema CHECK forbids dismissing it);
 *  - `fanned_out_at` is written only by the final step, so an interrupted
 *    instance is exactly the row the nightly reconciliation re-runs.
 *
 * The resume proof is end to end: one interrupted fan-out that leaves
 * `fanned_out_at` null, then `reconcileUnfannedTakedowns`, whose `create` stub
 * drives the production fan-out again. It asserts a fresh instance id the
 * interrupted run never held (`<id>-1`), because Cloudflare Workflows reject a
 * duplicate instance id and a crashed instance holds its id for as long as it
 * is retained.
 */

const NOW = "2026-09-22T13:00:00.000Z";

function stepStub(names: string[]): WorkflowStep {
  const step = {
    do: (name: string, ...rest: unknown[]) => {
      const callback = rest.at(-1) as (context: unknown) => Promise<unknown>;
      names.push(name);
      return callback({});
    },
  };
  return step as unknown as WorkflowStep;
}

function workflowEnv(): { DB: D1Database; CARD_ARTIFACTS: R2Bucket } {
  return env as unknown as { DB: D1Database; CARD_ARTIFACTS: R2Bucket };
}

async function runFanOut(takedownId: string): Promise<string[]> {
  const names: string[] = [];
  await fanOutTakedown(workflowEnv(), takedownId, stepStub(names));
  return names;
}

async function seedUserAndWorkspace(workspaceId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, ?, ?)`,
  )
    .bind(userId, "Owner", `${userId}@0509.io`, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, ?, ?, 'UTC', 1, 8, ?)`,
  )
    .bind(workspaceId, "Owner", userId, NOW)
    .run();
}

async function seedEntity(
  workspaceId: string,
  entityId: string,
  role: "self" | "competitor",
  domain: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, state, created_at)
     VALUES (?, ?, ?, ?, 'on', ?)`,
  )
    .bind(entityId, workspaceId, role, domain, NOW)
    .run();
}

async function seedSource(sourceId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key, is_enabled)
     VALUES (?, ?, 'site', 'web', ?, 1)`,
  )
    .bind(sourceId, sourceId, sourceId)
    .run();
}

async function seedWatch(entityId: string, sourceId: string, watchId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key, is_active)
     VALUES (?, ?, ?, ?, 1)`,
  )
    .bind(watchId, entityId, sourceId, watchId)
    .run();
}

async function seedSnapshot(watchId: string, r2Key: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO snapshot (id, watch_id, fetched_at, payload_r2_key, payload_hash, item_count)
     VALUES (?, ?, ?, ?, ?, 0)`,
  )
    .bind(`snap-${watchId}`, watchId, NOW, r2Key, `hash-${watchId}`)
    .run();
  await env.CARD_ARTIFACTS.put(r2Key, "<html>body</html>");
}

async function seedSignal(
  workspaceId: string,
  entityId: string,
  sourceId: string,
  signalId: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, dedup_key, observed_at)
     VALUES (?, ?, ?, ?, 'change', 'home', ?, ?)`,
  )
    .bind(signalId, workspaceId, entityId, sourceId, signalId, NOW)
    .run();
}

async function seedGrantedTakedown(id: string, subjectValue: string): Promise<void> {
  await seedGrantedTakedownKind(id, "domain", subjectValue);
}

async function seedGrantedTakedownKind(
  id: string,
  subjectKind: "domain" | "handle",
  subjectValue: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO takedown (id, subject_kind, subject_value, reason, requested_at, actioned_at, actioned_by, fanned_out_at, note)
     VALUES (?, ?, ?, 'subject asked', ?, ?, 'deputy', NULL, NULL)`,
  )
    .bind(id, subjectKind, subjectValue, NOW, NOW)
    .run();
}

async function entityState(entityId: string): Promise<{ state: string; state_reason: string | null; state_changed_by: string | null } | null> {
  return env.DB.prepare("SELECT state, state_reason, state_changed_by FROM entity WHERE id = ?")
    .bind(entityId)
    .first();
}

async function remainingKeys(): Promise<string[]> {
  const listed = await env.CARD_ARTIFACTS.list();
  return listed.objects.map((object) => object.key);
}

async function signalCount(entityId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT count(*) AS n FROM signal WHERE entity_id = ?")
    .bind(entityId)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

async function alertCount(workspaceId: string, kind = "takedown"): Promise<number> {
  const row = await env.DB.prepare("SELECT count(*) AS n FROM alert WHERE workspace_id = ? AND kind = ?")
    .bind(workspaceId, kind)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM alert"),
    env.DB.prepare("DELETE FROM signal"),
    env.DB.prepare("DELETE FROM takedown"),
    env.DB.prepare("DELETE FROM entity"),
    env.DB.prepare("DELETE FROM source"),
    env.DB.prepare("DELETE FROM workspace"),
    env.DB.prepare('DELETE FROM "user"'),
  ]);
  const listed = await env.CARD_ARTIFACTS.list();
  for (const object of listed.objects) await env.CARD_ARTIFACTS.delete(object.key);
});

describe("the takedown table (0004_takedown.sql)", () => {
  it("makes a duplicate subject idempotent through UNIQUE (subject_kind, subject_value)", async () => {
    await seedGrantedTakedown("td-1", "removed.example");
    await expect(seedGrantedTakedown("td-2", "removed.example")).rejects.toThrow();
  });

  it("keeps the row after the fan-out, because onboarding checks it", async () => {
    await seedGrantedTakedown("td-keep", "kept.example");
    const row = await env.DB.prepare("SELECT id FROM takedown WHERE subject_value = ?")
      .bind("kept.example")
      .first<{ id: string }>();
    expect(row?.id).toBe("td-keep");
  });
});

describe("TakedownWorkflow", () => {
  it("dismisses the competitor in every workspace, deletes signals and R2 objects, and alerts both owners", async () => {
    await seedUserAndWorkspace("ws-1", "user-1");
    await seedUserAndWorkspace("ws-2", "user-2");
    await seedSource("src-1");
    await seedEntity("ws-1", "ent-1", "competitor", "removed.example");
    await seedEntity("ws-2", "ent-2", "competitor", "removed.example");
    await seedSignal("ws-1", "ent-1", "src-1", "sig-1");
    await seedSignal("ws-2", "ent-2", "src-1", "sig-2");
    await seedWatch("ent-1", "src-1", "watch-1");
    await seedWatch("ent-2", "src-1", "watch-2");
    await seedSnapshot("watch-1", "snapshot/ws-1/watch-1/body.html");
    await seedSnapshot("watch-2", "snapshot/ws-2/watch-2/body.html");
    await seedGrantedTakedown("td-1", "removed.example");

    await runFanOut("td-1");

    for (const entityId of ["ent-1", "ent-2"]) {
      const row = await entityState(entityId);
      expect(row?.state).toBe("dismissed");
      expect(row?.state_reason).toBe("takedown");
      expect(row?.state_changed_by).toBe("auto");
      expect(await signalCount(entityId)).toBe(0);
    }
    expect(await alertCount("ws-1")).toBe(1);
    expect(await alertCount("ws-2")).toBe(1);
    expect(await remainingKeys()).toEqual([]);

    const fanned = await env.DB.prepare("SELECT fanned_out_at FROM takedown WHERE id = ?")
      .bind("td-1")
      .first<{ fanned_out_at: string | null }>();
    expect(fanned?.fanned_out_at).not.toBeNull();
  });

  it("leaves a role='self' row on and records the fact on takedown.note", async () => {
    await seedUserAndWorkspace("ws-self", "user-self");
    await seedEntity("ws-self", "ent-self", "self", "removed.example");
    await seedGrantedTakedown("td-self", "removed.example");

    await runFanOut("td-self");

    const self = await entityState("ent-self");
    expect(self?.state).toBe("on");
    const note = await env.DB.prepare("SELECT note FROM takedown WHERE id = ?")
      .bind("td-self")
      .first<{ note: string | null }>();
    expect(note?.note).toContain("role='self'");
    expect(await alertCount("ws-self")).toBe(1);
  });

  it("writes fanned_out_at only from the last step, so an interrupted run stays reconcilable", async () => {
    await seedUserAndWorkspace("ws-1", "user-1");
    await seedEntity("ws-1", "ent-1", "competitor", "removed.example");
    await seedGrantedTakedown("td-interrupted", "removed.example");

    const names: string[] = [];
    const failing: WorkflowStep = {
      do: async (name: string, ...rest: unknown[]) => {
        const callback = rest.at(-1) as (context: unknown) => Promise<unknown>;
        names.push(name);
        if (name.startsWith("remove subject from workspace")) {
          throw new Error("simulated interruption after gathering");
        }
        return callback({});
      },
    } as unknown as WorkflowStep;

    await expect(fanOutTakedown(workflowEnv(), "td-interrupted", failing)).rejects.toThrow(
      "simulated interruption",
    );

    expect(names.at(-1)).toBe("remove subject from workspace 1 of 1");
    const partial = await env.DB.prepare("SELECT fanned_out_at FROM takedown WHERE id = ?")
      .bind("td-interrupted")
      .first<{ fanned_out_at: string | null }>();
    expect(partial?.fanned_out_at).toBeNull();
  });

  it("parks a handle takedown with fanned_out_at NULL and the reason on note", async () => {
    await seedUserAndWorkspace("ws-h", "user-h");
    await seedEntity("ws-h", "ent-h", "competitor", "removed.example");
    await seedGrantedTakedownKind("td-handle", "handle", "@RemovedCreator");

    await runFanOut("td-handle");

    expect(await entityState("ent-h")).toMatchObject({ state: "on" });
    const row = await env.DB.prepare("SELECT fanned_out_at, note FROM takedown WHERE id = ?")
      .bind("td-handle")
      .first<{ fanned_out_at: string | null; note: string | null }>();
    expect(row?.fanned_out_at).toBeNull();
    expect(row?.note).toContain("subject unresolved");
    expect(row?.note).toContain("P1.1");
    expect(await alertCount("ws-h")).toBe(0);
  });

  it("parks a channel-URL handle takedown the same way, because it is still a handle", async () => {
    await seedUserAndWorkspace("ws-c", "user-c");
    await seedEntity("ws-c", "ent-c", "competitor", "removed.example");
    await seedGrantedTakedownKind("td-chan", "handle", "https://www.youtube.com/user/removedcreator");

    await runFanOut("td-chan");

    expect(await entityState("ent-c")).toMatchObject({ state: "on" });
    const row = await env.DB.prepare("SELECT fanned_out_at, note FROM takedown WHERE id = ?")
      .bind("td-chan")
      .first<{ fanned_out_at: string | null; note: string | null }>();
    expect(row?.fanned_out_at).toBeNull();
    expect(row?.note).toContain("subject unresolved");
  });

  it("dismisses the entity when a domain takedown names the domain the entity row holds", async () => {
    await seedUserAndWorkspace("ws-d", "user-d");
    await seedEntity("ws-d", "ent-d", "competitor", "removed.example");
    await seedGrantedTakedown("td-domain", "removed.example");

    await runFanOut("td-domain");

    expect(await entityState("ent-d")).toMatchObject({ state: "dismissed" });
  });

  it("parks a domain takedown whose value is a URL, because the join key must be the bare registrable", async () => {
    await seedUserAndWorkspace("ws-u", "user-u");
    await seedEntity("ws-u", "ent-u", "competitor", "removed.example");
    await seedGrantedTakedown("td-url", "https://www.removed.example/en-GB/");

    await runFanOut("td-url");

    expect(await entityState("ent-u")).toMatchObject({ state: "on" });
    const row = await env.DB.prepare("SELECT fanned_out_at, note FROM takedown WHERE id = ?")
      .bind("td-url")
      .first<{ fanned_out_at: string | null; note: string | null }>();
    expect(row?.fanned_out_at).toBeNull();
    expect(row?.note).toContain("subject unresolved");
  });

  it(
    "deletes more than one R2 batch in one workspace without exhausting a step",
    { timeout: 90_000 },
    async () => {
    await seedUserAndWorkspace("ws-big", "user-big");
    await seedSource("src-big");
    await seedEntity("ws-big", "ent-big", "competitor", "big.example");
    await seedWatch("ent-big", "src-big", "watch-big");
    await seedGrantedTakedown("td-big", "big.example");

    const total = 1_050;
    const keys = Array.from({ length: total }, (_v, i) =>
      `snapshot/ws-big/watch-big/object-${String(i).padStart(5, "0")}.html`,
    );
    // Batched: 1,050 single-row round trips spend more time in the workerd RPC
    // boundary than the batch-under-test spends deleting, and starved the file's
    // 30 s budget once the resume tests were added beside it.
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      await env.DB.batch(
        chunk.map((key) =>
          env.DB.prepare(
            `INSERT INTO snapshot (id, watch_id, fetched_at, payload_r2_key, payload_hash, item_count)
             VALUES (?, 'watch-big', ?, ?, ?, 0)`,
          ).bind(`snap-big-${key}`, NOW, key, `hash-${key}`),
        ),
      );
    }
    for (const key of keys) await env.CARD_ARTIFACTS.put(key, "<html>body</html>");

    await runFanOut("td-big");

    const remaining = (await env.CARD_ARTIFACTS.list()).objects.map((object) => object.key);
    expect(remaining).toEqual([]);
    const fanned = await env.DB.prepare("SELECT fanned_out_at FROM takedown WHERE id = ?")
      .bind("td-big")
      .first<{ fanned_out_at: string | null }>();
    expect(fanned?.fanned_out_at).not.toBeNull();
    },
  );

  it("completes a takedown for a subject no workspace tracks yet and records why", async () => {
    await seedGrantedTakedown("td-nomatch", "nobodytracks.example");

    await runFanOut("td-nomatch");

    const row = await env.DB.prepare("SELECT fanned_out_at, note FROM takedown WHERE id = ?")
      .bind("td-nomatch")
      .first<{ fanned_out_at: string | null; note: string | null }>();
    expect(row?.fanned_out_at).not.toBeNull();
    expect(row?.note).toContain("no workspace tracks nobodytracks.example");
  });

  it("is idempotent: a second run over the same subject changes nothing and does not re-alert", async () => {
    await seedUserAndWorkspace("ws-1", "user-1");
    await seedSource("src-1");
    await seedEntity("ws-1", "ent-1", "competitor", "removed.example");
    await seedSignal("ws-1", "ent-1", "src-1", "sig-1");
    await seedGrantedTakedown("td-1", "removed.example");

    await runFanOut("td-1");
    const firstAlerts = await alertCount("ws-1");
    const cleared = await env.DB.prepare("UPDATE takedown SET fanned_out_at = NULL WHERE id = ?").bind("td-1").run();
    expect(cleared.meta.changes).toBe(1);
    await runFanOut("td-1");

    expect(await entityState("ent-1")).toMatchObject({ state: "dismissed" });
    expect(await signalCount("ent-1")).toBe(0);
    expect(await alertCount("ws-1")).toBe(firstAlerts);
  });
});

describe("the nightly reconciliation", () => {
  it("runs once per day, on the 03:00 tick only", async () => {
    expect(RECONCILIATION_UTC_HOUR).toBe(3);

    const calls: string[] = [];
    const fakeEnv = {
      DB: env.DB,
      TAKEDOWN_WORKFLOW: {
        create: (options: { id: string }) => {
          calls.push(options.id);
          return Promise.resolve({});
        },
      },
    };

    expect(await runNightlyReconciliation(fakeEnv as never, new Date("2026-09-22T02:59:00Z"))).toBe(
      false,
    );
    expect(await runNightlyReconciliation(fakeEnv as never, new Date("2026-09-22T03:00:00Z"))).toBe(
      true,
    );
    expect(await runNightlyReconciliation(fakeEnv as never, new Date("2026-09-22T03:04:59Z"))).toBe(
      true,
    );
    expect(await runNightlyReconciliation(fakeEnv as never, new Date("2026-09-22T03:05:00Z"))).toBe(
      false,
    );
    expect(await runNightlyReconciliation(fakeEnv as never, new Date("2026-09-22T03:55:00Z"))).toBe(
      false,
    );
    expect(await runNightlyReconciliation(fakeEnv as never, new Date("2026-09-22T04:00:00Z"))).toBe(
      false,
    );
  });

  it("skips a parked row: an un-resolvable subject is not re-driven every night", async () => {
    await seedGrantedTakedownKind("td-parked", "handle", "@RemovedCreator");
    await env.DB.prepare(
      "UPDATE takedown SET note = 'subject unresolved: a handle has no join key' WHERE id = 'td-parked'",
    ).run();
    await seedGrantedTakedown("td-live", "live.example");

    const calls: string[] = [];
    const fakeEnv = {
      DB: env.DB,
      TAKEDOWN_WORKFLOW: {
        create: (options: { id: string }) => {
          calls.push(options.id);
          return Promise.resolve({});
        },
      },
    };

    const reran = await reconcileUnfannedTakedowns(fakeEnv as never);
    expect(reran).toEqual(["td-live"]);
    expect(calls).toEqual(["td-live-1"]);
  });

  it("re-runs only the granted takedowns whose fan-out has not completed", async () => {
    await seedGrantedTakedown("td-pending", "pending.example");
    await seedGrantedTakedown("td-done", "done.example");
    await env.DB.prepare("UPDATE takedown SET fanned_out_at = ? WHERE id = 'td-done'").bind(NOW).run();
    await seedGrantedTakedown("td-ungranted", "ungranted.example");
    await env.DB.prepare(
      "UPDATE takedown SET actioned_at = NULL, actioned_by = NULL WHERE id = 'td-ungranted'",
    ).run();

    const calls: string[] = [];
    const fakeEnv = {
      DB: env.DB,
      TAKEDOWN_WORKFLOW: {
        create: (options: { id: string }) => {
          calls.push(options.id);
          return Promise.resolve({});
        },
      },
    };

    const reran = await reconcileUnfannedTakedowns(fakeEnv as never);
    expect(reran).toEqual(["td-pending"]);
    expect(calls).toEqual(["td-pending-1"]);

    const done = await env.DB.prepare("SELECT fan_out_attempts FROM takedown WHERE id = 'td-done'")
      .first<{ fan_out_attempts: number }>();
    expect(done?.fan_out_attempts).toBe(0);
  });

  it("mints a fresh instance id per attempt, so a reconciled run is never the crashed one", async () => {
    await seedGrantedTakedown("td-attempts", "attempts.example");

    const firstIds: string[] = [];
    const crashing = {
      DB: env.DB,
      TAKEDOWN_WORKFLOW: {
        create: (options: { id: string }) => {
          firstIds.push(options.id);
          return Promise.reject(new Error("workflow instance crashed before any step ran"));
        },
      },
    };
    await expect(reconcileUnfannedTakedowns(crashing as never)).rejects.toThrow(
      "workflow instance crashed",
    );
    expect(firstIds).toEqual(["td-attempts-1"]);

    const secondIds: string[] = [];
    const calm = {
      DB: env.DB,
      TAKEDOWN_WORKFLOW: {
        create: (options: { id: string }) => {
          secondIds.push(options.id);
          return Promise.resolve({});
        },
      },
    };
    const reran = await reconcileUnfannedTakedowns(calm as never);
    expect(reran).toEqual(["td-attempts"]);
    expect(secondIds).toEqual(["td-attempts-2"]);
    expect(secondIds[0]).not.toBe(firstIds[0]);
  });

  it("resumes an interrupted fan-out end to end: the reconciled attempt completes it", async () => {
    await seedUserAndWorkspace("ws-e2e", "user-e2e");
    await seedSource("src-e2e");
    await seedEntity("ws-e2e", "ent-e2e", "competitor", "resumed.example");
    await seedSignal("ws-e2e", "ent-e2e", "src-e2e", "sig-e2e");
    await seedWatch("ent-e2e", "src-e2e", "watch-e2e");
    await seedSnapshot("watch-e2e", "snapshot/ws-e2e/watch-e2e/body.html");
    await seedGrantedTakedown("td-e2e", "resumed.example");

    const crashed: WorkflowStep = {
      do: async (name: string, ...rest: unknown[]) => {
        const callback = rest.at(-1) as (context: unknown) => Promise<unknown>;
        if (name.startsWith("remove subject from workspace")) {
          throw new Error("simulated interruption after gathering");
        }
        return callback({});
      },
    } as unknown as WorkflowStep;

    await expect(fanOutTakedown(workflowEnv(), "td-e2e", crashed)).rejects.toThrow(
      "simulated interruption",
    );

    const partial = await env.DB.prepare("SELECT fanned_out_at FROM takedown WHERE id = 'td-e2e'")
      .first<{ fanned_out_at: string | null }>();
    expect(partial?.fanned_out_at).toBeNull();
    expect(await entityState("ent-e2e")).toMatchObject({ state: "on" });

    // The reconciliation's create stub drives the production fan-out, so the
    // resumed attempt runs the same code the crashed one did and finishes it.
    const drivenIds: string[] = [];
    const drivingEnv = {
      DB: env.DB,
      TAKEDOWN_WORKFLOW: {
        create: (options: { id: string; params: { takedownId: string } }) => {
          drivenIds.push(options.id);
          const names: string[] = [];
          return fanOutTakedown(workflowEnv(), options.params.takedownId, stepStub(names)).then(
            () => ({}),
          );
        },
      },
    };

    const reran = await reconcileUnfannedTakedowns(drivingEnv as never);
    expect(reran).toEqual(["td-e2e"]);
    expect(drivenIds).toEqual(["td-e2e-1"]);

    const done = await env.DB.prepare("SELECT fanned_out_at FROM takedown WHERE id = 'td-e2e'")
      .first<{ fanned_out_at: string | null }>();
    expect(done?.fanned_out_at).not.toBeNull();
    expect(await entityState("ent-e2e")).toMatchObject({
      state: "dismissed",
      state_reason: "takedown",
      state_changed_by: "auto",
    });
    expect(await signalCount("ent-e2e")).toBe(0);
    expect(await remainingKeys()).toEqual([]);
    expect(await alertCount("ws-e2e")).toBe(1);

    // The row is complete, so the next reconciliation leaves it alone.
    const laterIds: string[] = [];
    const quietEnv = {
      DB: env.DB,
      TAKEDOWN_WORKFLOW: {
        create: (options: { id: string }) => {
          laterIds.push(options.id);
          return Promise.resolve({});
        },
      },
    };
    expect(await reconcileUnfannedTakedowns(quietEnv as never)).toEqual([]);
    expect(laterIds).toEqual([]);
  });

  it("isolates a per-row create failure so an old failing takedown does not starve new ones", async () => {
    await seedGrantedTakedown("td-old", "old.example");
    await env.DB.prepare(
      "UPDATE takedown SET fan_out_attempts = 5 WHERE id = 'td-old'",
    ).run();
    await seedGrantedTakedown("td-new", "new.example");

    const calls: string[] = [];
    const fakeEnv = {
      DB: env.DB,
      TAKEDOWN_WORKFLOW: {
        create: (options: { id: string }) => {
          calls.push(options.id);
          if (options.id.startsWith("td-old-")) return Promise.reject(new Error("binding unavailable"));
          return Promise.resolve({});
        },
      },
    };

    await expect(reconcileUnfannedTakedowns(fakeEnv as never)).rejects.toThrow("td-old");
    expect(calls).toEqual(["td-old-6", "td-new-1"]);
  });

  it("propagates a create failure when every row in the batch fails", async () => {
    await seedGrantedTakedown("td-broken", "broken.example");
    const fakeEnv = {
      DB: env.DB,
      TAKEDOWN_WORKFLOW: {
        create: () => Promise.reject(new Error("workflow binding unavailable")),
      },
    };
    await expect(reconcileUnfannedTakedowns(fakeEnv as never)).rejects.toThrow(
      "workflow binding unavailable",
    );
  });
});
