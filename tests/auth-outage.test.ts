import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("~/lib/auth.server");
  vi.resetModules();
});

describe("auth outage recovery", () => {
  it("turns an auth lookup outage into an HTTP 503 at the root loader", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      authSessionUnavailableResponse: () =>
        new Response("Authentication is temporarily unavailable. Please try again in a moment.", {
          headers: {
            "cache-control": "no-store",
            "retry-after": "5",
          },
          status: 503,
          statusText: "Authentication temporarily unavailable",
        }),
      getCachedOptionalSession: vi.fn().mockRejectedValue(new Error("raw D1 failure")),
      isAuthSessionUnavailableError: vi.fn().mockReturnValue(true),
    }));

    const { loader } = await import("~/root");
    let response: Response | null = null;
    try {
      await loader({
        context: { cloudflare: { env: {}, country: null } },
        params: {},
        request: new Request("https://0509.io/app"),
        url: "https://0509.io/app",
      } as never);
    } catch (error) {
      response = error as Response;
    }

    expect(response?.status).toBe(503);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(await response?.text()).not.toContain("raw D1 failure");
  });

  it("renders safe recovery wording without the backend error", async () => {
    const { ErrorBoundary } = await import("~/root");
    const element = ErrorBoundary({
      error: {
        data: "raw D1 failure",
        internal: false,
        status: 503,
        statusText: "Authentication temporarily unavailable",
      },
    });
    const html = collectText(element);

    expect(html).toContain("Authentication is temporarily unavailable");
    expect(html).not.toContain("raw D1 failure");
    expect(element.props).toMatchObject({
      "aria-live": "assertive",
      autoFocus: true,
      role: "alert",
      tabIndex: -1,
    });
  });

  it("does not mislabel an unrelated 503 as an authentication outage", async () => {
    const { ErrorBoundary } = await import("~/root");
    const html = collectText(
      ErrorBoundary({
        error: {
          data: "raw provider failure",
          internal: false,
          status: 503,
          statusText: "raw provider failure",
        },
      }),
    );

    expect(html).toContain("This part of Five to Nine is temporarily unavailable");
    expect(html).not.toContain("Authentication is temporarily unavailable");
    expect(html).not.toContain("raw provider failure");
  });
});

function collectText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(collectText).join(" ");
  if (value && typeof value === "object" && "props" in value) {
    return collectText((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}
