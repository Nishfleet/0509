import { describe, expect, it } from "vitest";

import { discoveryNotice, discoveryStateFor } from "../../app/lib/discovery/state";

describe("discoveryStateFor", () => {
  it.each(["queued", "running", "waiting", "waitingForPause"])("reads %s as still looking", (status) => {
    expect(discoveryStateFor(status)).toBe("looking");
  });

  it("reads complete as done", () => {
    expect(discoveryStateFor("complete")).toBe("done");
  });

  it.each(["errored", "terminated", "paused", "unknown"])("reads %s as unavailable", (status) => {
    expect(discoveryStateFor(status)).toBe("unavailable");
  });
});

describe("discoveryNotice", () => {
  it("says we are looking for brands while looking, even with suggestions", () => {
    expect(discoveryNotice("looking", 0)).toContain("looking for brands");
    expect(discoveryNotice("looking", 2)).toContain("looking for brands");
  });

  it("says we looked and found no obvious competitors once done with none", () => {
    const notice = discoveryNotice("done", 0);
    expect(notice).toContain("looked and found no obvious competitors");
    expect(notice).toContain("Add any you know");
  });

  it("says we could not look, and offers the manual path, when unavailable", () => {
    const notice = discoveryNotice("unavailable", 0);
    expect(notice).toContain("couldn't look");
    expect(notice).toContain("Add any you know");
  });

  it("stays quiet once there are competitors and nothing is running", () => {
    expect(discoveryNotice("done", 1)).toBeNull();
    expect(discoveryNotice("unavailable", 1)).toBeNull();
  });
});
