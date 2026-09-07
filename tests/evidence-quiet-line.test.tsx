import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import {
  QUIET_LINE_VISIBLE_LIMIT,
  QuietLine,
  QuietLineList,
} from "~/components/evidence/quiet-line";

/** BL-005 — brief §6.7: a check that found nothing is one dashed line. */

function renderRouted(element: React.ReactElement): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  return renderToStaticMarkup(<Stub initialEntries={["/"]} />);
}

const checks = Array.from({ length: 46 }, (_, index) => ({
  id: `check-${index}`,
  stamp: `${26 - (index % 26)} Jul · 04:00`,
  copy: "Checked. Nothing changed.",
}));

describe("QuietLine", () => {
  it("renders one line with no card, no icon and no warning styling", () => {
    const markup = renderToStaticMarkup(
      <QuietLine stamp="26 Jul · 04:00" copy="Checked. Nothing changed." />,
    );

    expect(markup).toContain("f9-evidence-quiet-line");
    expect(markup).toContain("Checked. Nothing changed.");
    expect(markup).not.toContain("is-warning");
    expect(markup).not.toContain("f9-evidence-panel");
  });

  it("drops the stamp instead of inventing one when the timestamp is missing", () => {
    const markup = renderToStaticMarkup(<QuietLine stamp={null} copy="Checked. Nothing changed." />);

    expect(markup).not.toContain("f9-evidence-quiet-stamp");
    expect(markup).toContain("Checked. Nothing changed.");
  });
});

describe("QuietLineList", () => {
  it("collapses past the fifth line into a Rank-3 load-more", () => {
    const markup = renderRouted(<QuietLineList items={checks} loadMore={{ to: "?checks=all" }} />);

    expect(markup.match(/f9-evidence-quiet-line/g)).toHaveLength(QUIET_LINE_VISIBLE_LIMIT);
    expect(markup).toContain("Load 41 earlier checks");
    expect(markup).toContain("f9-evidence-cta--rank3");
    // The control is a real destination, never a handler-less button.
    expect(markup).toContain('href="/?checks=all"');
  });

  it("singularises the load-more and drops it once expanded", () => {
    const six = checks.slice(0, 6);
    const collapsed = renderRouted(<QuietLineList items={six} loadMore={{ to: "?checks=all" }} />);
    expect(collapsed).toContain("Load 1 earlier check");

    const expanded = renderRouted(
      <QuietLineList items={six} loadMore={{ to: "?checks=all" }} expanded />,
    );
    expect(expanded).not.toContain("earlier check");
    expect(expanded.match(/f9-evidence-quiet-line/g)).toHaveLength(6);
  });

  it("shows the whole trail rather than a dead control when there is nowhere to go", () => {
    const markup = renderToStaticMarkup(<QuietLineList items={checks} />);

    expect(markup.match(/f9-evidence-quiet-line/g)).toHaveLength(checks.length);
    expect(markup).not.toContain("earlier check");
    expect(markup).not.toContain("f9-evidence-cta");
  });

  it("accepts a handler as a destination for client-side disclosure", () => {
    const markup = renderToStaticMarkup(
      <QuietLineList items={checks} loadMore={{ onClick: () => {} }} />,
    );

    expect(markup).toContain("Load 41 earlier checks");
    expect(markup).toContain("<button");
  });

  it("renders nothing when there is no audit trail to show", () => {
    expect(renderToStaticMarkup(<QuietLineList items={[]} />)).toBe("");
  });
});
