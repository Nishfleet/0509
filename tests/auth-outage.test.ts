import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("~/lib/auth.server");
  vi.resetModules();
});

describe("auth outage recovery", () => {
  it("keeps public pages available when optional auth lookup is unavailable", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/root");
    await expect(loader({
      context: { cloudflare: { env: {}, country: null } },
      params: {},
      request: new Request("https://0509.io/"),
      url: "https://0509.io/",
    } as never)).resolves.toMatchObject({ session: null });
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

    expect(html).toContain("Sign-in is temporarily unavailable.");
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
    expect(html).not.toContain("Sign-in is temporarily unavailable.");
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
