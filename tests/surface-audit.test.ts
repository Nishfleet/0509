import { describe, expect, it } from "vitest";

import { luminance, threshold } from "../e2e/contrast-audit.mjs";
import {
  SURFACE_AUDIT_RULES,
  SURFACE_AUDIT_USERS,
  SURFACE_AUDIT_VIEWPORTS,
  contrastFailuresFromLabels,
  controlRowFailuresFromGroups,
  focusRingFailuresFromChecks,
  gutterFailuresFromEdges,
  overflowFailuresFromWidth,
  tapTargetFailuresFromRects,
} from "../e2e/surface-audit.mjs";

describe("authenticated surface audit classifiers", () => {
  it("covers the paid-state fixtures and the three viewports the live defects needed", () => {
    expect(SURFACE_AUDIT_USERS).toEqual([
      "e2e-free",
      "e2e-scout",
      "e2e-starter",
      "e2e-agency",
      "e2e-expired",
    ]);
    expect(SURFACE_AUDIT_VIEWPORTS.map((item) => item.width)).toEqual([390, 1440, 2000]);
    expect(SURFACE_AUDIT_RULES).toContain("contrast");
    expect(SURFACE_AUDIT_RULES).toContain("control-row");
    expect(SURFACE_AUDIT_RULES).toContain("gutter");
  });

  it("flags a dark-mode plan CTA under WCAG AA the way contrast-audit already does", () => {
    const inkSoftOnWhite = {
      text: "Switch to Starter",
      className: "f9-plan-actions",
      color: "rgb(245, 242, 232)",
      background: "rgb(255, 255, 255)",
      fontSize: 14,
      fontWeight: "600",
      opacity: 1,
    };
    const ratio = (Math.max(luminance(inkSoftOnWhite.color), luminance(inkSoftOnWhite.background)) + 0.05)
      / (Math.min(luminance(inkSoftOnWhite.color), luminance(inkSoftOnWhite.background)) + 0.05);
    expect(ratio).toBeLessThan(threshold(14, "600"));
    expect(contrastFailuresFromLabels([inkSoftOnWhite])).toEqual([
      expect.objectContaining({ rule: "contrast", text: "Switch to Starter" }),
    ]);
    expect(
      contrastFailuresFromLabels([{ ...inkSoftOnWhite, color: "rgb(23, 22, 17)", opacity: 1 }]),
    ).toEqual([]);
  });

  it("flags a control row whose CTA sits more than 1px above the field", () => {
    expect(
      controlRowFailuresFromGroups([
        {
          selector: ".f9-overview-search",
          controls: [
            { text: "competitor.com", bottom: 400, left: 254, tag: "input" },
            { text: "Search ads", bottom: 369.3, left: 826, tag: "button" },
          ],
        },
      ]),
    ).toEqual([expect.objectContaining({ rule: "control-row", delta: 30.7 })]);
    expect(
      controlRowFailuresFromGroups([
        {
          selector: ".f9-overview-search",
          controls: [
            { text: "competitor.com", bottom: 400, left: 254, tag: "input" },
            { text: "Search ads", bottom: 400.4, left: 826, tag: "button" },
          ],
        },
      ]),
    ).toEqual([]);
    expect(
      controlRowFailuresFromGroups([
        {
          selector: ".f9-overview-search",
          controls: [
            { text: "competitor.com", bottom: 400, left: 24, tag: "input" },
            { text: "Search ads", bottom: 460, left: 24, tag: "button" },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it("flags section children whose content left edges do not share one gutter", () => {
    expect(
      gutterFailuresFromEdges([
        {
          selector: ".f9-evidence-setup-card",
          edges: [
            { className: "f9-evidence-setup-header", tag: "header", left: 254 },
            { className: "f9-evidence-setup-primary", tag: "form", left: 218 },
            { className: "f9-evidence-setup-links", tag: "div", left: 218 },
          ],
        },
      ]),
    ).toEqual([expect.objectContaining({ rule: "gutter", delta: 36 })]);
    expect(
      gutterFailuresFromEdges([
        {
          selector: ".f9-evidence-setup-card",
          edges: [
            { className: "f9-evidence-setup-header", tag: "header", left: 254 },
            { className: "f9-evidence-setup-primary", tag: "form", left: 254 },
          ],
        },
      ]),
    ).toEqual([]);
    expect(
      gutterFailuresFromEdges(
        [
          {
            selector: ".f9-evidence-setup-card",
            edges: [
              { className: "f9-evidence-setup-header", tag: "header", left: 254 },
              { className: "f9-evidence-setup-primary", tag: "form", left: 218 },
            ],
          },
        ],
        390,
      ),
    ).toEqual([]);
  });

  it("flags horizontal overflow, undersized touch targets, and missing focus rings", () => {
    expect(overflowFailuresFromWidth(2036, 2000)).toEqual([
      expect.objectContaining({ rule: "overflow", overflow: 36 }),
    ]);
    expect(overflowFailuresFromWidth(2000, 2000)).toEqual([]);
    expect(tapTargetFailuresFromRects([{ text: "Search ads", width: 88, height: 32 }], 390)).toEqual([
      expect.objectContaining({ rule: "tap", height: 32 }),
    ]);
    expect(tapTargetFailuresFromRects([{ text: "Search ads", width: 88, height: 32 }], 1440)).toEqual([]);
    expect(focusRingFailuresFromChecks([{ text: "Search ads", tag: "button", outline: "none 0px", ok: false }])).toEqual(
      [expect.objectContaining({ rule: "focus", text: "Search ads" })],
    );
  });
});
