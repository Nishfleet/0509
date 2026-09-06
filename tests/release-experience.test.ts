import { describe, expect, it } from "vitest";

const evaluatorModule =
  // @ts-ignore The pure evaluators intentionally live beside the Playwright helper, outside the app tsconfig roots.
  await import("../e2e/helpers/release-experience");
// @ts-ignore The release runner scope parser is a small Node helper intentionally outside the app tsconfig roots.
const scopeModule = await import("../e2e/helpers/release-scope.mjs");
const {
  hasMinimumTouchTarget,
  hasVisibleFocusTreatment,
  focusAdvanceKey,
  horizontalOverflowPx,
  reducedMotionIssues,
} = evaluatorModule;
const {
  isCanonicalReleaseScope,
  parseJourneyScope,
  resolveReleaseCandidateBase,
  resolveJourneyScope,
  resolveReleaseProofInvocation,
  resolveReleaseProofProject,
} = scopeModule;

describe("release experience pure contract evaluators", () => {
  it("validates an explicit release journey scope and defaults to all six journeys", () => {
    expect(parseJourneyScope("1,2")).toEqual([1, 2]);
    expect(parseJourneyScope("6, 3")).toEqual([6, 3]);
    expect(resolveJourneyScope([], {})).toEqual([1, 2, 3, 4, 5, 6]);
    expect(resolveJourneyScope(["--journeys=1,2"], {})).toEqual([1, 2]);
    expect(resolveJourneyScope([], { E2E_RELEASE_JOURNEYS: "2,1" })).toEqual([2, 1]);
    expect(() => parseJourneyScope("")).toThrow("invalid_release_journey_scope");
    expect(() => parseJourneyScope("1,1")).toThrow("duplicate_release_journey");
    expect(() => parseJourneyScope("0,7")).toThrow("invalid_release_journey_scope");
    expect(() => resolveJourneyScope(["--journeys="], {})).toThrow("invalid_release_journey_scope");
    expect(() => resolveJourneyScope(["--journeys=1", "--journeys=2"], {})).toThrow(
      "invalid_release_journey_scope",
    );
  });

  it("reserves canonical release proof for all six journeys and labels subsets diagnostic", () => {
    expect(isCanonicalReleaseScope([6, 5, 4, 3, 2, 1])).toBe(true);
    expect(isCanonicalReleaseScope([1, 2, 3, 4, 5])).toBe(false);
    expect(resolveReleaseProofInvocation([], {})).toEqual({
      journeys: [1, 2, 3, 4, 5, 6],
      diagnosticSubset: false,
    });
    expect(() =>
      resolveReleaseProofInvocation([], { E2E_RELEASE_JOURNEYS: "5" }),
    ).toThrow("canonical_release_requires_all_journeys");
    expect(() => resolveReleaseProofInvocation(["--journeys=5"], {})).toThrow(
      "canonical_release_requires_all_journeys",
    );
    expect(resolveReleaseProofInvocation(["--diagnostic-subset", "--journeys=5"], {})).toEqual({
      journeys: [5],
      diagnosticSubset: true,
    });
  });

  it("accepts only declared release browser projects and defaults to Chromium", () => {
    expect(resolveReleaseProofProject({})).toBe("local-release");
    expect(resolveReleaseProofProject({ E2E_RELEASE_PROJECT: "local-release-firefox" })).toBe(
      "local-release-firefox",
    );
    expect(resolveReleaseProofProject({ E2E_RELEASE_PROJECT: "local-release-webkit" })).toBe(
      "local-release-webkit",
    );
    expect(resolveReleaseProofProject({ E2E_RELEASE_PROJECT: "local-release-mobile-safari" })).toBe(
      "local-release-mobile-safari",
    );
    expect(resolveReleaseProofProject({ E2E_RELEASE_PROJECT: "local-release-mobile-chrome" })).toBe(
      "local-release-mobile-chrome",
    );
    expect(() => resolveReleaseProofProject({ E2E_RELEASE_PROJECT: "prod-auth" })).toThrow(
      "invalid_release_browser_project",
    );
  });

  it("identifies the checked-out candidate without requiring a deleted feature branch", () => {
    expect(resolveReleaseCandidateBase({})).toBe("HEAD");
    expect(resolveReleaseCandidateBase({ E2E_RELEASE_BASE: "release/base" })).toBe("release/base");
  });

  it("calculates document and nested horizontal overflow", () => {
    expect(horizontalOverflowPx({ scrollWidth: 375, clientWidth: 375 })).toBe(0);
    expect(horizontalOverflowPx({ scrollWidth: 376, clientWidth: 375 })).toBe(1);
    expect(horizontalOverflowPx({ scrollWidth: 420, clientWidth: 375 })).toBe(45);
  });

  it("requires actionable controls to meet the 44px touch target", () => {
    expect(hasMinimumTouchTarget({ width: 44, height: 44 })).toBe(true);
    expect(hasMinimumTouchTarget({ width: 43.9999, height: 44 })).toBe(true);
    expect(hasMinimumTouchTarget({ width: 43.99, height: 44 })).toBe(false);
    expect(hasMinimumTouchTarget({ width: 48, height: 40 })).toBe(false);
  });

  it("uses Safari's real link-focus gesture without changing other keyboard transitions", () => {
    expect(focusAdvanceKey("webkit")).toBe("Alt+Tab");
    expect(focusAdvanceKey("firefox")).toBe("Tab");
    expect(focusAdvanceKey("webkit", "Shift+Tab")).toBe("Shift+Tab");
  });

  it("recognizes visible keyboard focus treatments", () => {
    expect(
      hasVisibleFocusTreatment({
        outlineStyle: "solid",
        outlineWidth: "2px",
        outlineColor: "rgb(0, 0, 0)",
        boxShadow: "none",
      }),
    ).toBe(true);
    expect(hasVisibleFocusTreatment({ outlineStyle: "none", boxShadow: "none" })).toBe(false);
    expect(hasVisibleFocusTreatment({ outlineStyle: "none", boxShadow: "0 0 0 3px blue" })).toBe(true);
  });

  it("flags reduced-motion animations, transitions, and smooth scrolling", () => {
    expect(
      reducedMotionIssues({
        animationName: "none",
        animationDuration: "0s",
        transitionProperty: "none",
        transitionDuration: "0ms",
        scrollBehavior: "auto",
      }),
    ).toEqual([]);
    expect(
      reducedMotionIssues({
        animationName: "pulse",
        animationDuration: "200ms",
        transitionProperty: "opacity",
        transitionDuration: "0.2s",
        scrollBehavior: "smooth",
      }),
    ).toEqual([
      "animation pulse remains active",
      "transition opacity remains active",
      "scroll behavior remains smooth",
    ]);
  });
});
