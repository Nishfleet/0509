import { describe, expect, it, vi } from "vitest";

import { createWorkerEnvCheck, WorkerEnvError, workerEnvFailureResponse } from "../app/lib/env.server";

function configured() {
  return {
    DB: { prepare: () => "stmt" },
    BETTER_AUTH_URL: "https://0509.io",
    BETTER_AUTH_SECRET: "present",
    EMAIL: {},
    SEND_EMAIL: { sendBatch: () => "queued" },
    CARD_ARTIFACTS: { get: () => "card" },
    BROWSER: {},
  };
}

function namesOf(check: ReturnType<typeof createWorkerEnvCheck>, env: object) {
  try {
    check(env);
  } catch (error) {
    expect(error).toBeInstanceOf(WorkerEnvError);
    return error as WorkerEnvError;
  }
  expect.fail("expected a misconfigured env to throw");
}

describe("worker env", () => {
  it("accepts every required entry and an unset liveness URL", () => {
    const check = createWorkerEnvCheck({});
    expect(() => check(configured())).not.toThrow();
  });

  it("names every missing entry in one error", () => {
    const env = configured();
    delete env.DB;
    delete env.BETTER_AUTH_SECRET;
    const error = namesOf(createWorkerEnvCheck({}), env);
    expect(error.names).toEqual(["DB", "BETTER_AUTH_SECRET"]);
    expect(error.message).toBe(
      "misconfigured: DB (every read and write fails); BETTER_AUTH_SECRET (sign-in cannot be trusted)",
    );
    expect(error.message).not.toContain("present");
  });

  it("names a malformed URL without echoing it", () => {
    const env = { ...configured(), BETTER_AUTH_URL: "not-a-url" };
    const error = namesOf(createWorkerEnvCheck({ LIVENESS_PING_URL: "also-not-a-url" }), env);
    expect(error.names).toEqual(["BETTER_AUTH_URL", "LIVENESS_PING_URL"]);
    expect(error.message).not.toContain("not-a-url");
    expect(error.message).not.toContain("also-not-a-url");
  });

  it("treats a blank secret as missing and does not invent one", () => {
    const env = { ...configured(), BETTER_AUTH_SECRET: "   " };
    const error = namesOf(createWorkerEnvCheck({}), env);
    expect(error.names).toEqual(["BETTER_AUTH_SECRET"]);
  });

  it("checks once per isolate", () => {
    const check = createWorkerEnvCheck({});
    check(configured());
    expect(() => check({})).not.toThrow();

    const failing = createWorkerEnvCheck({});
    const first = namesOf(failing, {});
    const second = namesOf(failing, configured());
    expect(second.message).toBe(first.message);
    expect(second.names).toEqual([
      "DB",
      "BETTER_AUTH_URL",
      "BETTER_AUTH_SECRET",
      "EMAIL",
      "SEND_EMAIL",
      "CARD_ARTIFACTS",
      "BROWSER",
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
