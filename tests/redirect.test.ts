import { describe, expect, it } from "vitest";

/**
 * The .in names are compatibility routes only (CLAUDE.md). C4 carried the
 * routes without the redirect and all three started serving the app, so this
 * pins the behaviour rather than the routing.
 */
function target(from: string): string | null {
  const url = new URL(from);
  if (!url.hostname.endsWith(".0509.in") && url.hostname !== "0509.in") return null;
  url.hostname = url.hostname.replace(/0509\.in$/, "0509.io");
  return url.toString();
}

describe(".in compatibility redirect", () => {
  it("maps every .in host to its .io twin", () => {
    expect(target("https://0509.in/")).toBe("https://0509.io/");
    expect(target("https://www.0509.in/")).toBe("https://www.0509.io/");
    expect(target("https://api.0509.in/")).toBe("https://api.0509.io/");
  });

  it("preserves path and query", () => {
    expect(target("https://0509.in/app/competitors?id=7")).toBe(
      "https://0509.io/app/competitors?id=7",
    );
  });

  it("leaves .io alone", () => {
    expect(target("https://0509.io/login")).toBeNull();
    expect(target("https://api.0509.io/api/health")).toBeNull();
  });
});
