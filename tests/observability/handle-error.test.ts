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

  it("tags an encoded token with the route pattern, leaking neither its raw nor its encoded form", () => {
    const error = new Error("loader exploded");
    const request = new Request("https://0509.io/u/caf%c3%a9");
    const params = { token: "café" };

    handleError(error, { request, params, context: new RouterContextProvider() });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, { tags: { route: "/u/:token" } });
    const calls = JSON.stringify(vi.mocked(captureException).mock.calls);
    expect(calls).not.toContain("caf%c3%a9");
    expect(calls).not.toContain("caf%C3%A9");
    expect(calls).not.toContain("café");
  });

  it("tags an encoded splat with the route pattern, leaking neither its raw nor its decoded form", () => {
    const error = new Error("oauth failed");
    const request = new Request("https://0509.io/api/auth/caf%C3%A9");
    const params = { "*": "café" };

    handleError(error, { request, params, context: new RouterContextProvider() });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, { tags: { route: "/api/auth/*" } });
    const calls = JSON.stringify(vi.mocked(captureException).mock.calls);
    expect(calls).not.toContain("caf%C3%A9");
    expect(calls).not.toContain("caf%c3%a9");
    expect(calls).not.toContain("café");
  });

  it("tags a splat left raw by a malformed segment with the route pattern", () => {
    const error = new Error("oauth failed");
    const request = new Request("https://0509.io/api/auth/caf%C3%A9/%zz");
    const params = { "*": "caf%C3%A9/%zz" };

    handleError(error, { request, params, context: new RouterContextProvider() });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, { tags: { route: "/api/auth/*" } });
    const calls = JSON.stringify(vi.mocked(captureException).mock.calls);
    expect(calls).not.toContain("caf%C3%A9");
    expect(calls).not.toContain("café");
    expect(calls).not.toContain("%zz");
  });

  it("keeps a token carrying an encoded slash on the route pattern", () => {
    const error = new Error("loader exploded");
    const request = new Request("https://0509.io/u/a%2Fb");
    const params = { token: "a/b" };

    handleError(error, { request, params, context: new RouterContextProvider() });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, { tags: { route: "/u/:token" } });
    const calls = JSON.stringify(vi.mocked(captureException).mock.calls);
    expect(calls).not.toContain("a%2Fb");
    expect(calls).not.toContain("a/b");
  });

  it("keeps a splat carrying an encoded slash on the route pattern", () => {
    const error = new Error("oauth failed");
    const request = new Request("https://0509.io/api/auth/callback%2Fgoogle");
    const params = { "*": "callback/google" };

    handleError(error, { request, params, context: new RouterContextProvider() });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, { tags: { route: "/api/auth/*" } });
    const calls = JSON.stringify(vi.mocked(captureException).mock.calls);
    expect(calls).not.toContain("callback%2Fgoogle");
    expect(calls).not.toContain("callback/google");
  });

  it("tags a param the router left raw on a malformed segment, instead of throwing or leaking the segment", () => {
    const error = new Error("loader exploded");
    const request = new Request("https://0509.io/u/%zz");
    const params = { token: "%zz" };

    handleError(error, { request, params, context: new RouterContextProvider() });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, { tags: { route: "/u/:token" } });
    expect(JSON.stringify(vi.mocked(captureException).mock.calls)).not.toContain("%zz");
  });
});
