import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MISSING_VALUE,
  FACT_RAIL_MAX_ROWS,
  FactRail,
  isMissingFactValue,
} from "~/components/evidence/fact-rail";

/** BL-005 — brief §6.6: honest inline values replace the A2 six-box grid. */

describe("FactRail", () => {
  it("still renders the row when the value is missing, muted and in sentence case", () => {
    const markup = renderToStaticMarkup(
      <FactRail
        rows={[
          { key: "Price", value: null, missingLabel: "not published" },
          { key: "Offer", value: "" },
          { key: "Landing page", value: "example.com/offer" },
        ]}
      />,
    );

    expect(markup).toContain("Price");
    expect(markup).toContain("not published");
    expect(markup).toContain(DEFAULT_MISSING_VALUE);
    expect(markup.match(/is-missing/g)).toHaveLength(2);
    expect(markup).toContain("example.com/offer");
    // The honest degrade is a row, never an empty card.
    expect(markup).not.toContain("f9-evidence-panel");
  });

  it("edits the rail down to what an agency would quote", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      key: `Fact ${index}`,
      value: `Value ${index}`,
    }));
    const markup = renderToStaticMarkup(<FactRail rows={rows} />);

    expect(markup.match(/f9-evidence-fact-row/g)).toHaveLength(FACT_RAIL_MAX_ROWS);
    expect(markup).not.toContain("Fact 8");
  });

  it("renders nothing rather than an empty framed box when there are no rows", () => {
    expect(renderToStaticMarkup(<FactRail rows={[]} />)).toBe("");
  });

  it("treats blank, null, undefined and NaN as missing but keeps zero", () => {
    expect(isMissingFactValue(null)).toBe(true);
    expect(isMissingFactValue(undefined)).toBe(true);
    expect(isMissingFactValue("   ")).toBe(true);
    expect(isMissingFactValue(Number.NaN)).toBe(true);
    expect(isMissingFactValue(0)).toBe(false);
    expect(isMissingFactValue("₹1,199")).toBe(false);
  });
});
