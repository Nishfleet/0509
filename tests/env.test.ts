import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: {},
}));

import { env } from "cloudflare:workers";

import { createWorkerEnvCheck, WorkerEnvError, workerEnvFailureResponse } from "../app/lib/env.server";

const KEYS = [
  "DB",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "TURNSTILE_SECRET_KEY",
  "EMAIL",
  "SEND_EMAIL",
  "SNAPSHOTS",
  "BROWSER",
  "OAUTH_KV",
  "AGENT_LIMIT",
  "SIGN_IN_EMAIL_LIMIT",
  "SIGN_IN_IP_LIMIT",
  "AGENT_REGISTER_LIMIT",
  "PROBE_LIMIT",
] as const;

function configured() {
  return {
    DB: { prepare: () => "stmt" },
    BETTER_AUTH_URL: "https://0509.io",
    BETTER_AUTH_SECRET: "present",
    TURNSTILE_SECRET_KEY: "present",
    EMAIL: {},
    SEND_EMAIL: { sendBatch: () => "queued" },
    SNAPSHOTS: { get: () => "card" },
    BROWSER: {},
    OAUTH_KV: { get: () => "grant" },
    AGENT_LIMIT: { limit: () => ({ success: true }) },
    SIGN_IN_EMAIL_LIMIT: { limit: () => ({ success: true }) },
    SIGN_IN_IP_LIMIT: { limit: () => ({ success: true }) },
    AGENT_REGISTER_LIMIT: { limit: () => ({ success: true }) },
    PROBE_LIMIT: { limit: () => ({ success: true }) },
  };
}

function useEnv(values: object) {
  for (const key of KEYS) Reflect.deleteProperty(env, key);
  Object.assign(env, values);
}

function namesOf(check: () => void) {
  try {
    check();
  } catch (error) {
    expect(error).toBeInstanceOf(WorkerEnvError);
    return error as WorkerEnvError;
  }
  expect.fail("expected a misconfigured env to throw");
}

describe("worker env", () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, "LIVENESS_PING_URL");
    Reflect.deleteProperty(globalThis, "SITE_SWEEP_PING_URL");
    useEnv({});
  });

  it("accepts every required entry and an unset liveness URL", () => {
    useEnv(configured());
    expect(() => createWorkerEnvCheck()()).not.toThrow();
  });

  it("names every missing entry in one error", () => {
    const values = configured();
    delete values.DB;
    delete values.BETTER_AUTH_SECRET;
    useEnv(values);
    const error = namesOf(createWorkerEnvCheck());
    expect(error.names).toEqual(["DB", "BETTER_AUTH_SECRET"]);
    expect(error.message).toBe(
      "misconfigured: DB (every read and write fails); BETTER_AUTH_SECRET (sign-in cannot be trusted)",
    );
    expect(error.message).not.toContain("present");
  });

  it("names a malformed URL without echoing it", () => {
    useEnv({ ...configured(), BETTER_AUTH_URL: "not-a-url" });
    Reflect.set(globalThis, "LIVENESS_PING_URL", "also-not-a-url");
    Reflect.set(globalThis, "SITE_SWEEP_PING_URL", "sweep-not-a-url");
    const error = namesOf(createWorkerEnvCheck());
    expect(error.names).toEqual(["BETTER_AUTH_URL", "LIVENESS_PING_URL", "SITE_SWEEP_PING_URL"]);
    expect(error.message).not.toContain("not-a-url");
    expect(error.message).not.toContain("also-not-a-url");
    expect(error.message).not.toContain("sweep-not-a-url");
  });

  it("treats a blank secret as missing and does not invent one", () => {
    useEnv({ ...configured(), BETTER_AUTH_SECRET: "   " });
    const error = namesOf(createWorkerEnvCheck());
    expect(error.names).toEqual(["BETTER_AUTH_SECRET"]);
  });

  it("treats a blank turnstile secret as missing", () => {
    useEnv({ ...configured(), TURNSTILE_SECRET_KEY: "   " });
    const error = namesOf(createWorkerEnvCheck());
    expect(error.names).toEqual(["TURNSTILE_SECRET_KEY"]);
    expect(error.message).toContain("a botnet can spray sign-in links");
  });

  it("checks once per isolate", () => {
    const check = createWorkerEnvCheck();
    useEnv(configured());
    expect(() => check()).not.toThrow();
    useEnv({});
    expect(() => check()).not.toThrow();

    const failing = createWorkerEnvCheck();
    useEnv({});
    const first = namesOf(failing);
    useEnv(configured());
    const second = namesOf(failing);
    expect(second.message).toBe(first.message);
    expect(second.names).toEqual([
      "DB",
      "BETTER_AUTH_URL",
      "BETTER_AUTH_SECRET",
      "TURNSTILE_SECRET_KEY",
      "EMAIL",
      "SEND_EMAIL",
      "SNAPSHOTS",
      "BROWSER",
      "OAUTH_KV",
      "AGENT_LIMIT",
      "SIGN_IN_EMAIL_LIMIT",
      "SIGN_IN_IP_LIMIT",
      "AGENT_REGISTER_LIMIT",
      "PROBE_LIMIT",
    ]);
  });

  it("returns 503 and logs the same names", () => {
    const error = new WorkerEnvError(["BETTER_AUTH_SECRET"]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = workerEnvFailureResponse(error);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(spy).toHaveBeenCalledWith(error.message);
    return response.text().then((body) => {
      expect(body).toBe(error.message);
      expect(body).toContain("BETTER_AUTH_SECRET");
      spy.mockRestore();
    });
  });
});
