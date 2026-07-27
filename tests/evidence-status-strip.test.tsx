import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { STATUS_STRIP_MAX_CELLS, StatusStrip } from "~/components/evidence/status-strip";

/** BL-005 — brief §6.3: one strip replaces seven scattered status cards. */

function renderRouted(element: React.ReactElement): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  return renderToStaticMarkup(<Stub initialEntries={["/"]} />);
}

describe("StatusStrip", () => {
  it("renders an honest inline value for a cell with nothing in it", () => {
    const markup = renderToStaticMarkup(
      <StatusStrip
        cells={[
          { key: "State", value: "Watching" },
          { key: "Next check", value: null, missingLabel: "not scheduled yet" },
        ]}
      />,
    );

    expect(markup).toContain("Next check");
    expect(markup).toContain("not scheduled yet");
    expect(markup).toContain("f9-ed-status-value is-missing");
    // Never a spinner and never a card.
    expect(markup).not.toContain("skeleton");
    expect(markup).not.toContain("f9-ed-panel");
  });

  it("caps the strip at five cells including the single Rank-3 action", () => {
    const cells = Array.from({ length: 9 }, (_, index) => ({
      key: `Cell ${index}`,
      value: `Value ${index}`,
    }));

    const markup = renderRouted(
      <StatusStrip cells={cells} action={{ label: "Check now", to: "/app/watchlists" }} />,
    );

    expect(markup.match(/f9-ed-status-cell/g)).toHaveLength(STATUS_STRIP_MAX_CELLS);
    expect(markup).toContain("Check now");
    expect(markup).toContain("f9-ed-cta--rank3");
    expect(markup).not.toContain("f9-ed-cta--rank1");
    expect(markup).not.toContain("Cell 4");
  });

  it("uses all five cells for facts when the page has no strip-level action", () => {
    const cells = Array.from({ length: 6 }, (_, index) => ({
      key: `Cell ${index}`,
      value: `Value ${index}`,
    }));
    const markup = renderToStaticMarkup(<StatusStrip cells={cells} />);

    expect(markup.match(/f9-ed-status-cell/g)).toHaveLength(STATUS_STRIP_MAX_CELLS);
  });

  it("renders nothing rather than an empty ruled bar", () => {
    expect(renderToStaticMarkup(<StatusStrip cells={[]} />)).toBe("");
  });
});
