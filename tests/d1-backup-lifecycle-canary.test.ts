import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  assertExpectedLifecyclePolicy,
  buildBackupCanaryObjectKey,
  canonicalizeLifecycleRules,
  cleanupBackupLifecycleCanary,
  deleteObjectWithRetry,
  isConfirmedR2ObjectMissing,
  runBackupLifecycleCanary,
} from "../scripts/d1-backup-lifecycle-canary.mjs";

const liveRules = [
  {
    id: "0509-d1-backups-90d",
    enabled: true,
    conditions: { prefix: "backups/d1/" },
    deleteObjectsTransition: { condition: { type: "Age", maxAge: 90 * 86_400 } },
  },
];

describe("D1 backup lifecycle Gate C canary", () => {
  it("canonicalizes exact enabled prefix expiry and rejects drift", () => {
    const policy = JSON.parse(readFileSync("config/r2-retention-policy.json", "utf8"));
    const canonical = canonicalizeLifecycleRules([...liveRules].reverse());
    expect(assertExpectedLifecyclePolicy(policy, canonical)).toBe(true);
    expect(() => assertExpectedLifecyclePolicy(policy, canonical.map((rule) => ({
      ...rule,
      deleteMaxAge: rule.prefix === "backups/d1/" ? 30 * 86_400 : rule.deleteMaxAge,
    })))).toThrow("r2_lifecycle_policy_drift");
    expect(() => assertExpectedLifecyclePolicy(policy, canonical.concat({
      id: "unsafe-global-30d",
      enabled: true,
      prefix: "",
      deleteConditionType: "Age",
      deleteMaxAge: 30 * 86_400,
    }))).toThrow("r2_lifecycle_unsafe_overlap");
    expect(() => assertExpectedLifecyclePolicy(policy, canonical.concat({
      id: "unsafe-proof-artifacts-180d",
      enabled: true,
      prefix: "landing-pages/2026/",
      deleteConditionType: "Age",
      deleteMaxAge: 180 * 86_400,
    }))).toThrow("r2_lifecycle_unsafe_overlap");
    expect(() => assertExpectedLifecyclePolicy(policy, canonical.concat({
      id: "unsafe-proof-artifacts-date",
      enabled: true,
      prefix: "landing-pages/",
      deleteConditionType: "Date",
      deleteMaxAge: null,
    }))).toThrow("r2_lifecycle_unsafe_overlap");
    expect(() => assertExpectedLifecyclePolicy(policy, canonical.concat({
      id: "unsafe-canary-date",
      enabled: true,
      prefix: "backups/d1/canary/",
      deleteConditionType: "Date",
      deleteMaxAge: null,
    }))).toThrow("r2_lifecycle_unsafe_overlap");
    expect(assertExpectedLifecyclePolicy(policy, canonical.concat({
      id: "safe-backups-180d",
      enabled: true,
      prefix: "backups/",
      deleteConditionType: "Age",
      deleteMaxAge: 180 * 86_400,
    }))).toBe(true);
  });

  it("accepts only Wrangler's exact object-missing result as absence", () => {
    expect(isConfirmedR2ObjectMissing(Object.assign(new Error("failed"), {
      safeStderr: "✘ [ERROR] The specified key does not exist.\n",
    }))).toBe(true);
    expect(isConfirmedR2ObjectMissing(Object.assign(new Error("failed"), {
      safeStderr: "✘ [ERROR] 403 Forbidden\n",
    }))).toBe(false);
  });

  it("uses a deletion-safe deterministic Gate C object key", () => {
    expect(buildBackupCanaryObjectKey("Worker V1", "a".repeat(64))).toBe(
      `backups/d1/canary/gate-c/worker-v1/${"a".repeat(64)}.json`,
    );
  });

  it("records the injected failure and one real delete attempt", async () => {
    const operation = vi.fn(async () => undefined);
    await expect(deleteObjectWithRetry({ operation })).resolves.toEqual({
      ok: true,
      attempts: 2,
      errors: ["r2_delete_injected_once"],
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("proves live policy, write/read equality, retrying delete, and absence", async () => {
    let object: Buffer | null = null;
    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      const operation = args[3];
      if (operation === "put") {
        const path = args[args.indexOf("--file") + 1];
        object = readFileSync(path);
        return;
      }
      if (operation === "get") {
        if (!object) throw Object.assign(new Error("object not found"), {
          safeStderr: "✘ [ERROR] The specified key does not exist.\n",
        });
        const path = args[args.indexOf("--file") + 1];
        writeFileSync(path, object);
        return;
      }
      if (operation === "delete") {
        object = null;
        return;
      }
      throw new Error(`unexpected operation ${operation}`);
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      success: true,
      result: { rules: liveRules },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await runBackupLifecycleCanary({
      workerVersionId: "worker-v1",
      gateRunId: "gate-c-worker-v1",
      accountId: "a".repeat(32),
      apiToken: "token",
      now: () => new Date("2026-07-18T00:00:00.000Z"),
      fetchImpl,
      runCommand,
    });
    expect(result).toMatchObject({ ok: true, deleteAttempts: 2, remoteObjectAbsent: true });
    expect(object).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("performs cleanup-only recovery without uploading", async () => {
    let present = true;
    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[3] === "delete") {
        present = false;
        return;
      }
      if (args[3] === "get") {
        if (!present) throw Object.assign(new Error("not found"), {
          safeStderr: "✘ [ERROR] The specified key does not exist.\n",
        });
        return;
      }
      throw new Error("cleanup attempted an upload");
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      success: true,
      result: { rules: liveRules },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(cleanupBackupLifecycleCanary({
      workerVersionId: "worker-v1",
      accountId: "a".repeat(32),
      apiToken: "token",
      fetchImpl,
      runCommand,
    })).resolves.toMatchObject({ ok: true, remoteObjectAbsent: true });
    expect(runCommand.mock.calls.some(([, args]) => args[3] === "put")).toBe(false);
  });

  it("does not call auth or network failures object absence", async () => {
    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[3] === "delete") return;
      if (args[3] === "get") throw Object.assign(new Error("provider unavailable"), {
        safeStderr: "✘ [ERROR] Failed to fetch - 503 Service Unavailable\n",
      });
      throw new Error("cleanup attempted an upload");
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      success: true,
      result: { rules: liveRules },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(cleanupBackupLifecycleCanary({
      workerVersionId: "worker-v1",
      accountId: "a".repeat(32),
      apiToken: "token",
      fetchImpl,
      runCommand,
    })).rejects.toThrow("provider unavailable");
  });
});
