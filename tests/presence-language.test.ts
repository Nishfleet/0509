import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const ROUTE_PATH = "app/routes/app.presence.tsx";
const CSS_PATH = "app/app.css";
const MARKER = "/* === BL-034 presence (landing language) === */";

function read(path: string) {
  return readFileSync(path, "utf8");
}

function functionSpan(source: string, start: string, end: string) {
  return source.slice(source.indexOf(start), source.indexOf(end));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe("BL-034 Presence landing language", () => {
  it("keeps the current loader and action byte-frozen", () => {
    const source = read(ROUTE_PATH);
    expect(
      sha256(
        functionSpan(
          source,
          "export async function loader",
          "export async function action",
        ),
      ),
    ).toBe("ef29182bd7a1b4a0bae608cb61f6b5c5af2448e94c3b2948b5d3f1df403105b2");
    expect(
      sha256(
        functionSpan(
          source,
          "export async function action",
          "export default function PresenceIndexRoute",
        ),
      ),
    ).toBe("ed5711954140ad539f7f751ea96deae4e4f3a7b18c9cdcb6a7b95c04ba4afad8");
  });

  it("removes the boxed Evidence Desk composition from the Presence route", () => {
    const source = read(ROUTE_PATH);
    for (const retired of [
      "DashboardPageHeader",
      "ActionFeedback",
      "EmptyState",
      "f9-wk-panel",
      "f9-dashboard-grid",
      "f9-work-list",
      "f9-work-row",
      "f9-app-kicker",
      "f9-primary-button",
    ]) {
      expect(source).not.toContain(retired);
    }
    expect(source).toContain('className="f9-wk-page f9-presence-page"');
    expect(source).toContain('className="f9-presence-coverage"');
    expect(source).toContain("<RuledList");
    expect(source).toContain("<WorkingHeader");
    expect(source).toContain("FeedbackStrip");
    expect(source).toContain("Source coverage");
    expect(source).toContain("Website and open-web");
    expect(source).not.toContain("whole-internet scanning");
  });

  it("keeps #478's quota-aware tracking setup on the BL-034 markup", () => {
    const source = read(ROUTE_PATH);
    // Per-mode capacity must gate the select, not just plan entitlement.
    expect(source).toContain("selfModeCanCreate");
    expect(source).toContain("competitorModeCanCreate");
    expect(source).toContain("hasAvailableTrackingMode");
    expect(source).toContain("planAllowsEntityCreation && hasEntityCapacity && hasAvailableTrackingMode");
    expect(source).not.toContain('defaultValue={data.competitorAllowed ? "competitor" : "self"}');
    // Coverage rows stay honest: a reason, an action, or an explicit nothing.
    expect(source).toContain("coverageNote");
    expect(source).toContain("No additional action is available.");
  });

  it("spends no page green, one rule weight, and no rounded corner", () => {
    const css = read(CSS_PATH);
    expect(css.match(new RegExp(MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
    // BL-034 is no longer the last section in app.css — BL-040 owns the
    // final one — so bound this slice at the next `/* === ` section heading
    // instead of at EOF. Every assertion below still covers the whole
    // BL-034 block; it just stops leaking into the block after it.
    const start = css.indexOf(MARKER);
    const nextHeading = css.indexOf("\n/* === ", start + MARKER.length);
    const section =
      nextHeading < 0 ? css.slice(start) : css.slice(start, nextHeading);
    expect(section).not.toMatch(/--green\b|--ed-accent\b|#16c47f|#0a7b62|#65d5bb/i);
    expect([...section.matchAll(/border(?:-(?:top|right|bottom|left))?:\s*([0-9.]+px)/g)]
      .map((match) => match[1])
      .filter((value, index, values) => values.indexOf(value) === index))
      .toEqual(["1px"]);
    expect([...section.matchAll(/border-radius:\s*([^;]+);/g)].map((match) => match[1]))
      .toEqual(["0"]);
    expect(section).toContain("animation-duration: 0.01ms !important;");
    expect(section).toContain("animation-iteration-count: 1 !important;");
  });

  it("keeps caps-mono ornament out of the route and atomic feedback in the shared strip", () => {
    const source = read(ROUTE_PATH);
    const feedback = read("app/components/workspace/feedback-strip.tsx");
    expect(source).not.toContain("f9-wk-kick");
    expect(source).not.toContain("textTransform");
    expect(feedback).toContain('aria-atomic="true"');
  });
});
