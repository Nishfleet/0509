import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { experimental_readRawConfig } from "wrangler";

import { env } from "cloudflare:workers";

import {
  createWorkerEnvCheck,
  landingWorkspaceId,
  PUBLIC_PLACEHOLDER_NAMES,
  PUBLIC_PLACEHOLDER_VALUES,
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
  "DODO_WEBHOOK_SECRET",
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
    if (match?.[1] !== undefined) secrets[match[1]] = match[2] ?? "";
  }
  return secrets;
}

describe("worker env", () => {
  beforeEach(() => {
    useEnv({});
  });

  it("accepts every required entry and an unset liveness URL", () => {
    useEnv(configured());
    expect(() => {
      createWorkerEnvCheck()();
    }).not.toThrow();
  });

  it("names every missing entry in one error", () => {
    const values = configured();
    const { DB: _droppedDb, BETTER_AUTH_SECRET: _droppedSecret, ...missing } = values;
    expect(_droppedDb).toBeDefined();
    expect(_droppedSecret).toBeDefined();
    useEnv(missing);
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
      expect(() => {
        createWorkerEnvCheck()();
      }).not.toThrow();
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

  // 0509#7087. .dev.vars.example is committed and its values are public. They
  // are right for the local origins wrangler dev and the e2e lane ask for, and
  // wrong for the Worker: a production boot holding either one signs sign-in
  // links, or verifies payment webhooks, with a secret anyone can read out of
  // the repository. The gate rejects them under the variable's own name, so the
  // 503 an operator reads is the same shape as a missing entry.
  it("refuses the public placeholder secrets on the production origin", () => {
    useEnv({
      ...configured(),
      BETTER_AUTH_SECRET: "local-only-not-a-production-secret",
      DODO_WEBHOOK_SECRET: "whsec_bG9jYWwtb25seS1ub3QtYS13ZWJob29rLXNlY3JldA==",
    });
    const error = namesOf(createWorkerEnvCheck());
    expect(error.names).toEqual(["BETTER_AUTH_SECRET", "DODO_WEBHOOK_SECRET"]);
    expect(error.message).toContain("misconfigured: BETTER_AUTH_SECRET");
    expect(error.message).not.toContain("local-only-not-a-production-secret");
    expect(error.message).not.toContain("whsec_");
  });

  // The table is hand-mirrored from .dev.vars.example, and that is the same
  // drift the origin pin closes. Change the example file and this goes red, so
  // the gate cannot quietly stop covering production.
  it("pins the placeholder table to the values .dev.vars.example ships", () => {
    const example = exampleSecrets();
    for (const name of PUBLIC_PLACEHOLDER_NAMES) {
      expect(example[name], `.dev.vars.example no longer ships ${name}`).toBe(PUBLIC_PLACEHOLDER_VALUES[name]);
    }
  });

  // 0509#7170. Main used to keep a "still accepts the Cloudflare dummy
  // turnstile keys on the production origin" test because
  // tests/integration/wrangler.test.jsonc ran on this origin with those keys
  // on purpose. That reason is the acceptance this issue removes: dummy keys
  // on SITE_URL mean sign-in has no real captcha, so the same placeholder
  // table now refuses them.
  it("refuses the Cloudflare dummy turnstile keys on the production origin", () => {
    useEnv({
      ...configured(),
      TURNSTILE_SITE_KEY: PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET_KEY: PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SECRET_KEY,
    });
    const error = namesOf(createWorkerEnvCheck());
    expect(error.names).toEqual(["TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY"]);
    expect(error.message).toContain("misconfigured: TURNSTILE_SECRET_KEY");
    expect(error.message).toContain("TURNSTILE_SITE_KEY");
    expect(error.message).not.toContain(PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SITE_KEY);
    expect(error.message).not.toContain(PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SECRET_KEY);
  });

  it("refuses dummy turnstile keys when the production origin has a trailing slash", () => {
    useEnv({
      ...configured(),
      BETTER_AUTH_URL: `${SITE_URL}/`,
      TURNSTILE_SITE_KEY: PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET_KEY: PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SECRET_KEY,
    });
    const error = namesOf(createWorkerEnvCheck());
    expect(error.names).toEqual(["TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY"]);
  });

  // preview-assert's lighthouse step starts wrangler with
  // --env-file .dev.vars.example and no --var for BETTER_AUTH_URL. Wrangler
  // overlays keys that already exist in wrangler.jsonc vars, so the example
  // file must not ship SITE_URL or /design/landing answers 503 (run 37321905876).
  it("keeps the example env-file off the production origin", () => {
    const example = exampleSecrets();
    expect(example.BETTER_AUTH_URL, ".dev.vars.example no longer overrides BETTER_AUTH_URL").toBeDefined();
    expect(example.BETTER_AUTH_URL).not.toBe(SITE_URL);
  });

  it("starts lighthouse wrangler on the example env-file", () => {
    const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    expect(ci).toContain("npx wrangler dev --env-file .dev.vars.example");
  });

  it("turns document gzip off in the example env-file the preview lanes load (0509#7323)", () => {
    const example = exampleSecrets();
    expect(example.DOC_COMPRESSION, ".dev.vars.example no longer turns DOC_COMPRESSION off").toBe("off");
  });

  // playwright.config.ts --var and lighthouse's --env-file overlay both land
  // a loopback BETTER_AUTH_URL. The gate must accept the public placeholders
  // on that origin or the preview-assert lighthouse step 503s /design/landing.
  it("accepts the placeholder values on the example env-file origin", () => {
    const example = exampleSecrets();
    useEnv({
      ...configured(),
      BETTER_AUTH_URL: example.BETTER_AUTH_URL,
      BETTER_AUTH_SECRET: PUBLIC_PLACEHOLDER_VALUES.BETTER_AUTH_SECRET,
      DODO_WEBHOOK_SECRET: PUBLIC_PLACEHOLDER_VALUES.DODO_WEBHOOK_SECRET,
      TURNSTILE_SITE_KEY: PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET_KEY: PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SECRET_KEY,
    });
    expect(() => {
      createWorkerEnvCheck()();
    }).not.toThrow();
  });

  it("boots with no DODO_WEBHOOK_SECRET at all", () => {
    useEnv(configured());
    expect(() => {
      createWorkerEnvCheck()();
    }).not.toThrow();
  });

  it("answers 503 and names a placeholder secret without echoing it", async () => {
    useEnv({
      ...configured(),
      BETTER_AUTH_SECRET: "local-only-not-a-production-secret",
      DODO_WEBHOOK_SECRET: "whsec_bG9jYWwtb25seS1ub3QtYS13ZWJob29rLXNlY3JldA==",
    });
    const error = namesOf(createWorkerEnvCheck());
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = workerEnvFailureResponse(error);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.text();
      expect(body).toContain("BETTER_AUTH_SECRET");
      expect(body).toContain("DODO_WEBHOOK_SECRET");
      expect(body).not.toContain("local-only-not-a-production-secret");
      expect(body).not.toContain("whsec_");
      expect(spy).toHaveBeenCalledWith(error.message);
      expect(String(spy.mock.calls[0]?.[0])).not.toContain("local-only-not-a-production-secret");
      expect(String(spy.mock.calls[0]?.[0])).not.toContain("whsec_");
    } finally {
      spy.mockRestore();
    }
  });

  it("answers 503 and names a dummy turnstile key without echoing it", async () => {
    useEnv({
      ...configured(),
      TURNSTILE_SITE_KEY: PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET_KEY: PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SECRET_KEY,
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
      expect(body).not.toContain(PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SITE_KEY);
      expect(body).not.toContain(PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SECRET_KEY);
      expect(spy).toHaveBeenCalledWith(error.message);
      expect(String(spy.mock.calls[0]?.[0])).not.toContain(PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SITE_KEY);
      expect(String(spy.mock.calls[0]?.[0])).not.toContain(PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SECRET_KEY);
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
    expect(rawConfig.vars?.TURNSTILE_SITE_KEY).not.toBe(PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SITE_KEY);
    expect(rawConfig.vars?.TURNSTILE_SECRET_KEY).not.toBe(PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SECRET_KEY);
  });

  it("keeps dummy-token captcha tests on a non-production origin", () => {
    const captcha = readFileSync(
      new URL("./integration/magic-link-captcha.integration.test.ts", import.meta.url),
      "utf8",
    );
    expect(captcha).toContain(`const ORIGIN = "http://localhost:8787"`);
    expect(captcha).toContain(PUBLIC_PLACEHOLDER_VALUES.TURNSTILE_SECRET_KEY);
  });

  it("checks once per isolate", () => {
    const check = createWorkerEnvCheck();
    useEnv(configured());
    expect(() => {
      check();
    }).not.toThrow();
    useEnv({});
    expect(() => {
      check();
    }).not.toThrow();

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
