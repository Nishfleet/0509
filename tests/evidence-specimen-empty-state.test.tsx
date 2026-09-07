import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import {
  RESERVED_SLOT_COPY,
  RESERVED_SLOT_LABEL,
  SpecimenEmptyState,
} from "~/components/evidence/specimen-empty-state";

/** BL-005 — brief §6.8: an empty state is a panel, not a void (A2, A3). */

function renderRouted(element: React.ReactElement): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  return renderToStaticMarkup(<Stub initialEntries={["/"]} />);
}

const base = {
  stateLabel: "OKARA · FIRST CAPTURE RUNNING · STARTED 03:12 UTC",
  headline: "The first capture is running",
  copy: "About ten minutes. We take the ads, the offer page and the price — the 'before' that every future change gets measured against.",
};

describe("SpecimenEmptyState", () => {
  it("keeps a numbered reserved slot when there is no specimen to dim", () => {
    const markup = renderToStaticMarkup(<SpecimenEmptyState {...base} />);

    expect(markup).toContain(RESERVED_SLOT_LABEL);
    expect(markup).toContain(RESERVED_SLOT_COPY);
    expect(markup).toContain("f9-evidence-specimen-slot");
    // The real state, never a bare "No data".
    expect(markup).toContain("FIRST CAPTURE RUNNING");
    expect(markup).not.toContain("No data");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<svg");
  });

  it("dims a real specimen instead of the placeholder copy when one is given", () => {
    const markup = renderToStaticMarkup(
      <SpecimenEmptyState
        {...base}
        specimenLabel="PLATE 01 — PENDING"
        specimen={<p>Sample plate body</p>}
      />,
    );

    expect(markup).toContain("Sample plate body");
    expect(markup).not.toContain(RESERVED_SLOT_COPY);
    expect(markup).toContain("f9-evidence-specimen-slot-inner");
  });

  it("allows exactly one Rank-1 and at most one Rank-2", () => {
    const markup = renderRouted(
      <SpecimenEmptyState
        {...base}
        primaryAction={{ label: "Add competitor", to: "/app/watchlists" }}
        secondaryAction={{ label: "See an example", to: "/app/reports" }}
      />,
    );

    expect(markup.match(/f9-evidence-cta--rank1/g)).toHaveLength(1);
    expect(markup.match(/f9-evidence-cta--rank2/g)).toHaveLength(1);
    expect(markup).not.toContain("f9-evidence-cta--rank3");
  });

  it("renders the panel without an action row when there is nothing to do meanwhile", () => {
    const markup = renderToStaticMarkup(<SpecimenEmptyState {...base} />);
    expect(markup).not.toContain("f9-evidence-action-row");
    expect(markup).toContain("f9-evidence-specimen");
  });
});
