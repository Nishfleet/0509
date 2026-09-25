import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));

import { captureException } from "@sentry/cloudflare";
import { RouterContextProvider } from "react-router";

import { handleError } from "../../app/entry.server";

beforeEach(() => {
  vi.mocked(captureException).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("handleError", () => {
  it("captures a loader error tagged with the route pattern and leaks neither the token nor the query", () => {
    const error = new Error("loader exploded");
    const request = new Request("https://0509.io/u/tok-SECRET?utm=x");
    const params = { token: "tok-SECRET" };

    handleError(error, { request, params, context: new RouterContextProvider() });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, { tags: { route: "/u/:token" } });
    const calls = JSON.stringify(vi.mocked(captureException).mock.calls);
    expect(calls).not.toContain("tok-SECRET");
    expect(calls).not.toContain("utm");
  });

  it("does not capture when the request is already aborted", () => {
    const error = new Error("aborted");
    const controller = new AbortController();
    controller.abort();
    const request = new Request("https://0509.io/u/tok-SECRET", { signal: controller.signal });

    handleError(error, { request, params: { token: "tok-SECRET" }, context: new RouterContextProvider() });

    expect(captureException).not.toHaveBeenCalled();
  });

  it("does not capture a 4xx route error response", () => {
    const error = { status: 404, statusText: "Not Found", internal: true, data: null };
    const request = new Request("https://0509.io/nowhere");

    handleError(error, { request, params: { "*": "nowhere" }, context: new RouterContextProvider() });

    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures an api error tagged with the splat route pattern", () => {
    const error = new Error("oauth failed");
    const request = new Request("https://0509.io/api/auth/callback/google");
    const params = { "*": "callback/google" };

    handleError(error, { request, params, context: new RouterContextProvider() });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, { tags: { route: "/api/auth/*" } });
  });
});
