import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  cachedProbe,
  PROBE_TTL_SECONDS,
  probeKey,
} from "../../../app/lib/identity/probe-cache.server";
import { normaliseSubject } from "../../../app/lib/identity/normalise";

/**
 * The 24-hour KV probe cache (engine 1, issue #4419), pinned against the real
 * local KV namespace the workers project provisions from
 * tests/integration/wrangler.test.jsonc. The cache is the engine's resume
 * point: a miss runs the probe and writes the entry, a hit never runs, a value
 * that no longer parses is treated as a miss, and a failing probe writes
 * nothing — so a probe that breaks cannot poison the cache for 24 hours.
 *
 * The `env` import is `cloudflare:workers`, the same binding surface
 * app/lib/fetch/transport.server.ts reads, so seeding and inspecting go
 * through the binding shape production has.
 */
const normalised = normaliseSubject("gymshark.com");
if (!normalised.ok) throw new Error("gymshark.com must normalise to a subject");
const subject = normalised.subject;

const KEY = "identity:gymshark.com:homepage";
const NAME_SCHEMA = z.object({ name: z.string() });

describe("identity probe cache", () => {
  beforeEach(async () => {
    await env.IDENTITY_CACHE.delete(KEY);
  });

  it("keys identity:<registrable>:<probe>", () => {
    expect(probeKey(subject, "homepage")).toBe("identity:gymshark.com:homepage");
  });

  it("a miss calls run once, returns its value and writes the cache", async () => {
    expect(PROBE_TTL_SECONDS).toBe(86_400);
    const run = vi.fn(async () => ({ name: "Gymshark" }));

    const value = await cachedProbe(subject, "homepage", NAME_SCHEMA, run);

    expect(value).toEqual({ name: "Gymshark" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(await env.IDENTITY_CACHE.get(KEY, "json")).toEqual({ name: "Gymshark" });
  });

  it("a second call on the same key returns the cached value and never runs", async () => {
    const first = vi.fn(async () => ({ name: "Gymshark" }));
    await cachedProbe(subject, "homepage", NAME_SCHEMA, first);

    const second = vi.fn(async () => ({ name: "Fresh" }));
    const value = await cachedProbe(subject, "homepage", NAME_SCHEMA, second);

    expect(value).toEqual({ name: "Gymshark" });
    expect(second).toHaveBeenCalledTimes(0);
  });

  it("a cached value that fails the schema is treated as a miss and overwritten", async () => {
    await env.IDENTITY_CACHE.put(KEY, JSON.stringify({ wrong: true }));
    const run = vi.fn(async () => ({ name: "Gymshark" }));

    const value = await cachedProbe(subject, "homepage", NAME_SCHEMA, run);

    expect(value).toEqual({ name: "Gymshark" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(await env.IDENTITY_CACHE.get(KEY, "json")).toEqual({ name: "Gymshark" });
  });

  it("a rejecting run rejects cachedProbe and the key stays absent", async () => {
    const run = vi.fn(async () => {
      throw new Error("probe failed");
    });

    await expect(
      cachedProbe(subject, "homepage", NAME_SCHEMA, run),
    ).rejects.toThrow("probe failed");
    expect(await env.IDENTITY_CACHE.get(KEY, "json")).toBeNull();
  });
});
