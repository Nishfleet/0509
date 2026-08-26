import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_BASE_URL,
  FOLD_EPSILON_PX,
  NESTED_OVERFLOW_TOLERANCE_PX,
  SELECTORS,
  VIEWPORTS,
  evaluateTermination,
  evaluateViewport,
  findFirstViewportNestedOverflow,
  formatReport,
  isFallbackHeadline,
  rectInFold,
} from "../scripts/bet9-first-viewport-verification.mjs";

function inFoldRect(bottom = 800) {
  return { top: 100, bottom, height: bottom - 100, width: 300 };
}

type FoldRect = ReturnType<typeof inFoldRect>;

function passingSnapshot(fold = 900): {
  fold: number;
  scrollWidth: number;
  clientWidth: number;
  headline: FoldRect | null;
  valueProposition: FoldRect | null;
  cta: FoldRect & {
    tag: string;
    type: string;
    disabled: boolean;
    pointerEvents: string;
  };
  consoleErrors: string[];
  nestedOverflowCandidates: { selector: string; overflow: number; top: number }[];
} {
  return {
    fold,
    scrollWidth: 1440,
    clientWidth: 1440,
    headline: inFoldRect(Math.min(650, fold - 200)),
    valueProposition: inFoldRect(Math.min(790, fold - 80)),
    cta: {
      ...inFoldRect(fold - 20),
      tag: "BUTTON",
      type: "submit",
      disabled: false,
      pointerEvents: "auto",
    },
    consoleErrors: [] as string[],
    nestedOverflowCandidates: [],
  };
}

describe("BET 9 first-viewport constants", () => {
  it("locks the §3.4 termination viewports at 1440x900 and 390x844", () => {
    expect(VIEWPORTS).toEqual([
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ]);
  });

  it("targets the live homepage headline, deck, and search submit", () => {
    expect(SELECTORS.headline).toBe("h1.ld-wall");
    expect(SELECTORS.valueProposition).toBe("p.ld-deck-copy");
    expect(SELECTORS.cta).toBe(".ld-command button[type='submit']");
  });

  it("defaults the live canary to production and allows 1px of subpixel slack", () => {
    expect(DEFAULT_BASE_URL).toBe("https://0509.io");
    expect(FOLD_EPSILON_PX).toBe(1);
  });
});

describe("rectInFold", () => {
  it("accepts an element whose bottom sits on the fold", () => {
    expect(rectInFold({ top: 100, bottom: 900, height: 800, width: 200 }, 900)).toBe(
      true,
    );
  });

  it("accepts a 0.06px subpixel miss that the pre-#971 1440 check saw", () => {
    expect(
      rectInFold({ top: 824, bottom: 900.06, height: 76.06, width: 200 }, 900),
    ).toBe(true);
  });

  it("rejects an element 2px below the fold", () => {
    expect(
      rectInFold({ top: 824, bottom: 902, height: 78, width: 200 }, 900),
    ).toBe(false);
  });

  it("rejects a missing rect", () => {
    expect(rectInFold(null, 900)).toBe(false);
  });

  it("rejects an element that starts above the viewport", () => {
    expect(
      rectInFold({ top: -20, bottom: 200, height: 220, width: 200 }, 900),
    ).toBe(false);
  });
});

describe("isFallbackHeadline", () => {
  it("detects the short local H1 that is too small to prove the budget", () => {
    expect(isFallbackHeadline("Know when competitors change the offer before the call.")).toBe(
      true,
    );
  });

  it("treats the live Nykaa-length wall as the real budget", () => {
    expect(
      isFallbackHeadline(
        "“Unlock the secret to radiant…” was the hook on 12 Meta ads Aug 25 linking to nykaa.com. We saved the proof.",
      ),
    ).toBe(false);
  });
});

describe("isEmptyProofStrip", () => {
  it("detects the local empty strip that is too short to prove the #1212 budget", async () => {
    const { isEmptyProofStrip } = await import(
      "../scripts/bet9-first-viewport-verification.mjs"
    );
    expect(isEmptyProofStrip("Live proof No live proof yet")).toBe(true);
    expect(
      isEmptyProofStrip(
        "Live proof We saved the proof — nykaa.com Captured Aug 25 · Meta Ad Library",
      ),
    ).toBe(false);
  });
});

describe("findFirstViewportNestedOverflow", () => {
  it("keeps a nested overflow whose box starts inside the first viewport", () => {
    const candidates = [
      { selector: "a.ld-cta", overflow: 20, top: 700 },
    ];
    expect(findFirstViewportNestedOverflow(candidates, 844)).toEqual(candidates);
  });

  it("drops a below-the-fold overflow so a proof-actions link cannot flip the gate", () => {
    // Mirrors the #1262 deploy blocker: "Read the methodology" sits at top≈1495.
    const candidates = [
      { selector: "a", overflow: 20, top: 1495 },
    ];
    expect(findFirstViewportNestedOverflow(candidates, 844)).toEqual([]);
  });

  it("treats the 2px release-e2e floor as clean", () => {
    expect(NESTED_OVERFLOW_TOLERANCE_PX).toBe(2);
    expect(
      findFirstViewportNestedOverflow(
        [{ selector: "span", overflow: 2, top: 100 }],
        900,
      ),
    ).toEqual([]);
  });

  it("returns an empty list when the snapshot has no candidates", () => {
    expect(findFirstViewportNestedOverflow(undefined, 900)).toEqual([]);
    expect(findFirstViewportNestedOverflow(null, 900)).toEqual([]);
  });
});

describe("evaluateViewport", () => {
  it("passes when headline, deck, and a clickable submit all sit in the first viewport", () => {
    const verdict = evaluateViewport({
      name: "desktop",
      ...passingSnapshot(900),
    });
    expect(verdict.pass).toBe(true);
    for (const check of verdict.checks) {
      expect(check.ok, check.name).toBe(true);
    }
  });

  it("fails when the clickable CTA clips the fold", () => {
    const snapshot = passingSnapshot(844);
    snapshot.cta = {
      ...inFoldRect(882),
      bottom: 939,
      height: 57,
      tag: "BUTTON",
      type: "submit",
      disabled: false,
      pointerEvents: "auto",
    };
    const verdict = evaluateViewport({ name: "mobile", ...snapshot });
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((c) => c.name === "cta_in_first_viewport")?.ok).toBe(
      false,
    );
  });

  it("fails when the submit is present but not clickable", () => {
    const snapshot = passingSnapshot(900);
    snapshot.cta = {
      ...inFoldRect(860),
      tag: "BUTTON",
      type: "submit",
      disabled: true,
      pointerEvents: "none",
    };
    const verdict = evaluateViewport({ name: "desktop", ...snapshot });
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((c) => c.name === "cta_clickable")?.ok).toBe(false);
  });

  it("fails on horizontal overflow or a console error", () => {
    const overflow = passingSnapshot(900);
    overflow.scrollWidth = 392;
    overflow.clientWidth = 390;
    expect(evaluateViewport({ name: "mobile", ...overflow }).pass).toBe(false);

    const noisy = passingSnapshot(900);
    noisy.consoleErrors = ["TypeError: boom"];
    expect(evaluateViewport({ name: "desktop", ...noisy }).pass).toBe(false);
  });

  it("fails when the headline or value proposition is missing", () => {
    const noHeadline = passingSnapshot(900);
    noHeadline.headline = null;
    expect(evaluateViewport({ name: "desktop", ...noHeadline }).pass).toBe(false);

    const noDeck = passingSnapshot(900);
    noDeck.valueProposition = null;
    expect(evaluateViewport({ name: "desktop", ...noDeck }).pass).toBe(false);
  });

  it("fails when a first-viewport element overflows its box (the release-e2e class)", () => {
    const snapshot = passingSnapshot(844);
    snapshot.scrollWidth = 390;
    snapshot.clientWidth = 390;
    snapshot.nestedOverflowCandidates = [
      { selector: "a.ld-cta", overflow: 20, top: 760 },
    ];
    const verdict = evaluateViewport({ name: "mobile", ...snapshot });
    expect(verdict.pass).toBe(false);
    expect(
      verdict.checks.find((c) => c.name === "no_nested_overflow_in_first_viewport")
        ?.ok,
    ).toBe(false);
  });

  it("passes when the only nested overflow sits below the first viewport", () => {
    const snapshot = passingSnapshot(844);
    snapshot.scrollWidth = 390;
    snapshot.clientWidth = 390;
    snapshot.nestedOverflowCandidates = [
      { selector: "a", overflow: 20, top: 1495 },
    ];
    const verdict = evaluateViewport({ name: "mobile", ...snapshot });
    expect(verdict.pass).toBe(true);
    expect(
      verdict.checks.find((c) => c.name === "no_nested_overflow_in_first_viewport")
        ?.ok,
    ).toBe(true);
  });
});

describe("evaluateTermination", () => {
  it("passes only when every named viewport passes", () => {
    const desktop = evaluateViewport({ name: "desktop", ...passingSnapshot(900) });
    const mobile = evaluateViewport({
      name: "mobile",
      ...passingSnapshot(844),
      scrollWidth: 390,
      clientWidth: 390,
    });
    const verdict = evaluateTermination([desktop, mobile]);
    expect(verdict.pass).toBe(true);
    expect(verdict.viewports.map((v) => v.name)).toEqual(["desktop", "mobile"]);
  });

  it("fails the whole bet when one viewport misses the CTA", () => {
    const desktop = evaluateViewport({ name: "desktop", ...passingSnapshot(900) });
    const mobileSnap = passingSnapshot(844);
    mobileSnap.scrollWidth = 390;
    mobileSnap.clientWidth = 390;
    mobileSnap.cta = {
      ...inFoldRect(882),
      bottom: 939,
      height: 57,
      tag: "BUTTON",
      type: "submit",
      disabled: false,
      pointerEvents: "auto",
    };
    const mobile = evaluateViewport({ name: "mobile", ...mobileSnap });
    const verdict = evaluateTermination([desktop, mobile]);
    expect(verdict.pass).toBe(false);
    expect(verdict.viewports.find((v) => v.name === "mobile")?.pass).toBe(false);
  });
});

describe("formatReport", () => {
  it("names both viewports and the overall pass/fail", () => {
    const desktop = evaluateViewport({ name: "desktop", ...passingSnapshot(900) });
    const mobile = evaluateViewport({
      name: "mobile",
      ...passingSnapshot(844),
      scrollWidth: 390,
      clientWidth: 390,
    });
    const report = formatReport({
      baseUrl: "https://0509.io/",
      termination: evaluateTermination([desktop, mobile]),
    });
    expect(report).toContain("BET 9 first-viewport verification");
    expect(report).toContain("desktop 1440x900");
    expect(report).toContain("mobile 390x844");
    expect(report).toMatch(/PASS|FAIL/);
  });
});

describe("homepage still paints the measured selectors", () => {
  const marketing = readFileSync("app/routes/marketing.tsx", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  it("keeps the hero wall, deck, and search submit in the homepage route", () => {
    expect(marketing).toMatch(/className="ld-wall"/);
    expect(marketing).toMatch(/className="ld-deck-copy"/);
    expect(marketing).toMatch(/<Form className="ld-command"/);
    expect(marketing).toMatch(/<button type="submit">/);
    expect(marketing).toMatch(/className="ld-hero-callouts"/);
  });

  it("wires npm run canary:bet9 to the verification script", () => {
    expect(pkg.scripts["canary:bet9"]).toBe(
      "node scripts/bet9-first-viewport-verification.mjs --json",
    );
  });
});
