import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));
vi.mock("react-dom/server", () => ({
  renderToReadableStream: vi.fn(() =>
    Promise.resolve(Object.assign(new ReadableStream(), { allReady: Promise.resolve() })),
  ),
}));

import { captureException } from "@sentry/cloudflare";
import { RouterContextProvider, type EntryContext } from "react-router";

import handleRequest, { handleError } from "../../app/entry.server";

const routerContext = { isSpaMode: false } as unknown as EntryContext;

beforeEach(() => {
  vi.mocked(captureException).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("X-Error-Reference", () => {
  it("returns the Sentry event id on the response for the request that errored", async () => {
    vi.mocked(captureException).mockReturnValue("0123456789abcdef0123456789abcdef");
    const request = new Request("https://0509.io/onboarding/identity?subject=gymshark.com");

    handleError(new Error("loader exploded"), { request, params: {}, context: new RouterContextProvider() });
    const response = await handleRequest(request, 500, new Headers(), routerContext, new RouterContextProvider());

    expect(response.headers.get("X-Error-Reference")).toBe("0123456789abcdef0123456789abcdef");
  });

  it("sends no reference on a request that did not error", async () => {
    const request = new Request("https://0509.io/app");

    const response = await handleRequest(request, 200, new Headers(), routerContext, new RouterContextProvider());

    expect(response.headers.has("X-Error-Reference")).toBe(false);
  });
});
