import { afterEach, describe, expect, it, vi } from "vitest";

import { isLoginWall } from "../../app/lib/identity/normalise";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isLoginWall", () => {
  it("refuses a login address and does not fetch a page", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(isLoginWall("https://www.instagram.com/accounts/login")).toBe(true);
    expect(isLoginWall("https://www.instagram.com/accounts/login/")).toBe(true);
    expect(isLoginWall("https://x.com/i/flow/login")).toBe(true);
    expect(isLoginWall("https://accounts.google.com/")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not treat a profile, a domain, or a bare handle as a login wall", () => {
    expect(isLoginWall("https://www.instagram.com/gymshark/")).toBe(false);
    expect(isLoginWall("gymshark.com")).toBe(false);
    expect(isLoginWall("@john.smith")).toBe(false);
  });
});
