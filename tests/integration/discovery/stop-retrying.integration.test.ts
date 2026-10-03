import { env, introspectWorkflow } from "cloudflare:test";
import { NonRetryableError } from "cloudflare:workflows";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscoveryUnavailableError } from "../../../app/lib/discovery/run.server";
import { stopRetryingWhenRefused } from "../../../app/lib/discovery/refused.server";

const AT = "2026-09-28T03:00:00.000Z";
const ZEROS = { shortlisted: 0, queued: 0, promoted: 0, written: 0, judged: 0 };

async function seedWorkspace(id: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(`user-${id}`, `${id}@example.com`, AT),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(id, `user-${id}`, AT),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', 'gymshark.com', 'Gymshark', '{\"description\":\"Gym clothing\"}', ?3)",
    ).bind(`${id}-self`, id, AT),
  ]);
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

describe("stopRetryingWhenRefused", () => {
  it("turns a billing refusal into a NonRetryableError so the step is not retried", async () => {
    const refused = new DiscoveryUnavailableError("every discovery generator failed: ai: 2021 payment", true);

    const failure: unknown = await stopRetryingWhenRefused(() => Promise.reject(refused)).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(NonRetryableError);
    expect(failure).toHaveProperty("message", refused.message);
  });

  it("leaves an ordinary outage retryable and passes a result through", async () => {
    const outage = new DiscoveryUnavailableError("every discovery generator failed: ai: gateway down", false);

    const failure: unknown = await stopRetryingWhenRefused(() => Promise.reject(outage)).catch(
      (error: unknown) => error,
    );

    expect(failure).toBe(outage);
    expect(await stopRetryingWhenRefused(() => Promise.resolve(7))).toBe(7);
  });
});

describe("the Discovery workflow when Jev refuses", () => {
  it("skips the run before any proposer call", async () => {
    await seedWorkspace("ws-jev-down");
    const run = vi.fn(() => Promise.reject(new Error("2021: Payment error")));
    Reflect.set(env, "AI", { run });
    await using introspector = await introspectWorkflow(env.DISCOVERY);
    await introspector.modifyAll(async (modifier) => {
      await modifier.disableRetryDelays();
    });

    await env.DISCOVERY.create({ id: "discovery-ws-jev-down", params: { workspaceId: "ws-jev-down", mode: "create" } });
    const [instance] = await introspector.get();
    if (instance === undefined) throw new Error("discovery instance was not started");
    await instance.waitForStatus("complete");

    expect(await instance.getOutput()).toEqual({ workspaceId: "ws-jev-down", ...ZEROS });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("goes on to propose rivals when Jev answers", async () => {
    await seedWorkspace("ws-jev-up");
    const answer = { answers: { jev_probe: { type: "noul", noul: 0.9 } } };
    const run = vi.fn(() => Promise.resolve(answer));
    Reflect.set(env, "AI", { run });
    await using introspector = await introspectWorkflow(env.DISCOVERY);
    await introspector.modifyAll(async (modifier) => {
      await modifier.mockStepResult({ name: "backlog" }, []);
      await modifier.mockStepResult({ name: "generate" }, { shortlisted: [], rest: [], promoted: [] });
      await modifier.mockStepResult({ name: "resolve" }, []);
    });

    await env.DISCOVERY.create({ id: "discovery-ws-jev-up", params: { workspaceId: "ws-jev-up", mode: "create" } });
    const [instance] = await introspector.get();
    if (instance === undefined) throw new Error("discovery instance was not started");
    await instance.waitForStatus("complete");

    expect(await instance.getOutput()).toEqual({ workspaceId: "ws-jev-up", ...ZEROS });
    expect(run).toHaveBeenCalledTimes(1);
    expect(await instance.waitForStepResult({ name: "generate" })).toEqual({
      shortlisted: [],
      rest: [],
      promoted: [],
    });
  });
});
