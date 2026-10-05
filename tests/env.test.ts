import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { experimental_readRawConfig } from "wrangler";

import { env } from "cloudflare:workers";

import {
  createWorkerEnvCheck,
  landingWorkspaceId,
  PUBLIC_TURNSTILE_DUMMY_NAMES,
  PUBLIC_TURNSTILE_DUMMY_VALUES,
  WorkerEnvError,
  workerEnvFailureResponse,
} from "../app/lib/env.server";
import { SITE_URL } from "../app/lib/site-url";

const KEYS = [
  "DB",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_SITE_KEY",
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
  "CHANGE_EMAIL_LIMIT",
  "LIVENESS_PING_URL",
  "SITE_SWEEP_PING_URL",
] as const;

function configured() {
  return {
    DB: { prepare: () => "stmt" },
    BETTER_AUTH_URL: SITE_URL,
    BETTER_AUTH_SECRET: "present",
    TURNSTILE_SECRET_KEY: "present",
    TURNSTILE_SITE_KEY: "present",
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
    CHANGE_EMAIL_LIMIT: { limit: () => ({ success: true }) },
  };
}

function useEnv(values: object) {
  for (const key of KEYS) Reflect.deleteProperty(env, key);
  Reflect.deleteProperty(env, "LANDING_WORKSPACE_ID");
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

function exampleSecrets(): Record<string, string> {
  const secrets: Record<string, string> = {};
  const text = readFileSync(new URL("../.dev.vars.example", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) secrets[String(match[1])] = String(match[2]);
  }
  return secrets;
}

describe("worker env", () => {
  beforeEach(() => {
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
    useEnv({
      ...configured(),
      BETTER_AUTH_URL: "not-a-url",
      LIVENESS_PING_URL: "also-not-a-url",
      SITE_SWEEP_PING_URL: "sweep-not-a-url",
    });
    const error = namesOf(createWorkerEnvCheck());
    expect(error.names).toEqual(["BETTER_AUTH_URL", "LIVENESS_PING_URL", "SITE_SWEEP_PING_URL"]);
    expect(error.message).not.toContain("not-a-url");
    expect(error.message).not.toContain("also-not-a-url");
    expect(error.message).not.toContain("sweep-not-a-url");
  });

  it("reads the ping URLs off the Worker env, not globalThis", () => {
    useEnv(configured());
    Reflect.set(globalThis, "LIVENESS_PING_URL", "also-not-a-url");
    Reflect.set(globalThis, "SITE_SWEEP_PING_URL", "sweep-not-a-url");
    try {
      expect(() => createWorkerEnvCheck()()).not.toThrow();
    } finally {
      Reflect.deleteProperty(globalThis, "LIVENESS_PING_URL");
      Reflect.deleteProperty(globalThis, "SITE_SWEEP_PING_URL");
    }
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

  it("treats a blank turnstile site key as missing", () => {
    useEnv({ ...configured(), TURNSTILE_SITE_KEY: "   " });
    const error = namesOf(createWorkerEnvCheck());
    expect(error.names).toEqual(["TURNSTILE_SITE_KEY"]);
    expect(error.message).toContain("the sign-in form has no Turnstile widget");
  });

  // 0509#7170. .dev.vars.example ships Cloudflare's published dummy Turnstile
  // keys so local wrangler and lighthouse can mint. Those values on the
  // production origin mean sign-in has no real captcha. The gate rejects them
  // under the variable's own name, so the 503 an operator reads is the same
  // shape as a missing entry.
  it("refuses the Cloudflare dummy turnstile keys on the production origin", () => {
    useEnv({
      ...configured(),
      TURNSTILE_SITE_KEY: PUBLIC_TURNSTILE_DUMMY_VALUES.TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET_KEY: PUBLIC_TURNSTILE_DUMMY_VALUES.TURNSTILE_SECRET_KEY,
    });
    const error = namesOf(createWorkerEnvCheck());
    expect(error.names).toEqual(["TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY"]);
    expect(error.message).toContain("misconfigured: TURNSTILE_SECRET_KEY");
    expect(error.message).toContain("TURNSTILE_SITE_KEY");
    expect(error.message).not.toContain(PUBLIC_TURNSTILE_DUMMY_VALUES.TURNSTILE_SITE_KEY);
    expect(error.message).not.toContain(PUBLIC_TURNSTILE_DUMMY_VALUES.TURNSTILE_SECRET_KEY);
  });

  it("pins the dummy turnstile table to the values .dev.vars.example ships", () => {
    const example = exampleSecrets();
    for (const name of PUBLIC_TURNSTILE_DUMMY_NAMES) {
      expect(example[name], `.dev.vars.example no longer ships ${name}`).toBe(PUBLIC_TURNSTILE_DUMMY_VALUES[name]);
    }
  });

  // preview-assert's lighthouse step starts wrangler with
  // --env-file .dev.vars.example and no --var for BETTER_AUTH_URL. Wrangler
  // overlays keys that already exist in wrangler.jsonc vars, so the example
  // file must ship a non-production origin or /design/landing answers 503.
  it("keeps the example env-file off the production origin", () => {
    const example = exampleSecrets();
    expect(example.BETTER_AUTH_URL, ".dev.vars.example no longer overrides BETTER_AUTH_URL").toBeDefined();
    expect(example.BETTER_AUTH_URL).not.toBe(SITE_URL);
  });

  it("starts lighthouse wrangler on the example env-file", () => {
    const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    expect(ci).toContain("npx wrangler dev --env-file .dev.vars.example");
  });

  it("accepts the dummy turnstile keys on the example env-file origin", () => {
    const example = exampleSecrets();
    useEnv({
      ...configured(),
      BETTER_AUTH_URL: example.BETTER_AUTH_URL,
      TURNSTILE_SITE_KEY: PUBLIC_TURNSTILE_DUMMY_VALUES.TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET_KEY: PUBLIC_TURNSTILE_DUMMY_VALUES.TURNSTILE_SECRET_KEY,
    });
    expect(() => createWorkerEnvCheck()()).not.toThrow();
  });

  it("answers 503 and names a dummy turnstile key without echoing it", async () => {
    useEnv({
      ...configured(),
      TURNSTILE_SITE_KEY: PUBLIC_TURNSTILE_DUMMY_VALUES.TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET_KEY: PUBLIC_TURNSTILE_DUMMY_VALUES.TURNSTILE_SECRET_KEY,
    });
    const error = namesOf(createWorkerEnvCheck());
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = workerEnvFailureResponse(error);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.text();
      expect(body).toContain("TURNSTILE_SITE_KEY");
      expect(body).toContain("TURNSTILE_SECRET_KEY");
      expect(body).not.toContain(PUBLIC_TURNSTILE_DUMMY_VALUES.TURNSTILE_SITE_KEY);
      expect(body).not.toContain(PUBLIC_TURNSTILE_DUMMY_VALUES.TURNSTILE_SECRET_KEY);
      expect(spy).toHaveBeenCalledWith(error.message);
    } finally {
      spy.mockRestore();
    }
  });

  // tests/integration/wrangler.test.jsonc used to pin those dummy keys to
  // SITE_URL on purpose. After the gate closes, that config must use
  // non-dummy values or a non-production origin, or every workers test 503s.
  it("does not pin dummy turnstile keys to the production origin in the integration Worker", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "tests/integration/wrangler.test.jsonc" });
    expect(rawConfig.vars?.BETTER_AUTH_URL).toBe(SITE_URL);
    expect(rawConfig.vars?.TURNSTILE_SITE_KEY).not.toBe(PUBLIC_TURNSTILE_DUMMY_VALUES.TURNSTILE_SITE_KEY);
    expect(rawConfig.vars?.TURNSTILE_SECRET_KEY).not.toBe(PUBLIC_TURNSTILE_DUMMY_VALUES.TURNSTILE_SECRET_KEY);
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
      "TURNSTILE_SITE_KEY",
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
      "CHANGE_EMAIL_LIMIT",
    ]);
  });

  it("reads the public workspace id and treats a blank one as unset", () => {
    useEnv({ ...configured(), LANDING_WORKSPACE_ID: "  ws-public  " });
    expect(landingWorkspaceId()).toBe("ws-public");
    useEnv({ ...configured(), LANDING_WORKSPACE_ID: "   " });
    expect(landingWorkspaceId()).toBeNull();
    useEnv(configured());
    expect(landingWorkspaceId()).toBeNull();
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
