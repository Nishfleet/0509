import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_WINDOW_MINUTES,
  ON_SCREEN_DEADLINE_MS,
  buildEvidenceUrl,
  parseCliArgs,
  parseFlag,
} from "../scripts/bet7-activation-verification.mjs";

describe("buildEvidenceUrl", () => {
  it("returns a deterministic Meta Ad Library snapshot URL for the token", () => {
    expect(buildEvidenceUrl("abc123")).toBe(
      "https://www.facebook.com/ads/library/?id=bet7-abc123",
    );
  });
});

describe("parseFlag", () => {
  it("turns on for every legal parser value the onboard flag accepts", () => {
    for (const value of ["1", "true", "on", "yes"]) {
      expect(parseFlag(value)).toBe(true);
    }
  });

  it("tolerates whitespace and case, matching tests/env.server.test.ts", () => {
    expect(parseFlag(" 1 ")).toBe(true);
    expect(parseFlag("ON")).toBe(true);
    expect(parseFlag("True")).toBe(true);
  });

  it("turns off for empty, zero, and unknown values", () => {
    for (const value of ["", "0", "off", "false", "no", undefined, null]) {
      expect(parseFlag(value)).toBe(false);
    }
  });
});

describe("parseCliArgs", () => {
  it("defaults to a 60-minute window and the nykaa.com verify domain", () => {
    const args = parseCliArgs([]);
    expect(args.email).toBeNull();
    expect(args.domain).toBe("nykaa.com");
    expect(args.windowMinutes).toBe(DEFAULT_WINDOW_MINUTES);
    expect(args.json).toBe(false);
  });

  it("parses email, domain, window, and --json", () => {
    const args = parseCliArgs([
      "--email=fresh@canary.0509.test",
      "--domain=allbirds.com",
      "--window=30",
      "--json",
    ]);
    expect(args.email).toBe("fresh@canary.0509.test");
    expect(args.domain).toBe("allbirds.com");
    expect(args.windowMinutes).toBe(30);
    expect(args.json).toBe(true);
  });

  it("ignores an empty --email so a fresh one is minted per run", () => {
    const args = parseCliArgs(["--email=", "--window=5"]);
    expect(args.email).toBeNull();
    expect(args.windowMinutes).toBe(5);
  });

  it("rejects a non-positive or non-numeric window", () => {
    expect(() => parseCliArgs(["--window=0"])).toThrow(/invalid --window/);
    expect(() => parseCliArgs(["--window=-10"])).toThrow(/invalid --window/);
    expect(() => parseCliArgs(["--window=abc"])).toThrow(/invalid --window/);
  });
});

describe("termination deadlines", () => {
  it("holds the on-screen deadline at 5 minutes and the digest window at 60", () => {
    expect(ON_SCREEN_DEADLINE_MS).toBe(5 * 60 * 1000);
    expect(DEFAULT_WINDOW_MINUTES).toBe(60);
  });
});

describe("module exports", () => {
  it("keeps npm run canary:bet7 pointing at the live verification script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["canary:bet7"]).toBe(
      "node scripts/bet7-activation-verification.mjs --json",
    );
  });
});
