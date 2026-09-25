import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WhyFlaggedSheet } from "../../app/components/why-flagged";
import { Dialog, DialogContent } from "../../app/components/ui/dialog";
import {
  whyFlagged,
  type WhyFlagged,
  type WhyFlaggedDecision,
  type WhyFlaggedField,
} from "../../app/lib/why-flagged";

const COMPARED: readonly WhyFlaggedField[] = [
  { label: "Last week", value: "$49" },
  { label: "This week", value: "$39" },
];

const BASE = {
  verdictId: "v-1",
  p: 0.95,
  reason: "A move.",
  decidedAt: "2026-09-25T04:00:00Z",
  compared: COMPARED,
} as const;

const WHY: WhyFlagged = {
  verdictId: BASE.verdictId,
  compared: COMPARED,
  sure: "95%",
  decision: "Flagged",
  reason: "A move.",
  decidedAt: BASE.decidedAt,
};

function renderSheet(why: WhyFlagged = WHY): string {
  return renderToStaticMarkup(createElement(WhyFlaggedSheet, { why }));
}

function findElement(node: ReactNode, type: unknown): ReactElement | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    if (child.type === type) return child;
    const nested = findElement((child.props as { children?: ReactNode }).children, type);
    if (nested !== null) return nested;
  }
  return null;
}

function sheetContent(why: WhyFlagged = WHY): ReactElement<Record<string, unknown>> {
  const content = findElement(WhyFlaggedSheet({ why }), DialogContent);
  if (content === null) throw new Error("WhyFlaggedSheet rendered no DialogContent");
  return content as ReactElement<Record<string, unknown>>;
}

function contentBody(why: WhyFlagged = WHY): string {
  const content = sheetContent(why);
  // DialogTitle reads Base UI's root context, so the children render inside
  // the root the component already supplies.
  return renderToStaticMarkup(
    createElement(Dialog, null, createElement("div", null, content.props.children)),
  );
}

describe("whyFlagged", () => {
  it("returns null without a verdict, a p, a finite p or a decision time", () => {
    expect(whyFlagged({ ...BASE, verdictId: null })).toBeNull();
    expect(whyFlagged({ ...BASE, p: null })).toBeNull();
    expect(whyFlagged({ ...BASE, p: Number.NaN })).toBeNull();
    expect(whyFlagged({ ...BASE, decidedAt: null })).toBeNull();
  });

  it("rounds p to a percentage and maps noulAction to a decision word", () => {
    const expected: readonly { p: number; sure: string; decision: WhyFlaggedDecision }[] = [
      { p: 0.95, sure: "95%", decision: "Flagged" },
      { p: 0.5, sure: "50%", decision: "Possibly" },
      { p: 0.05, sure: "5%", decision: "Held back" },
    ];
    for (const { p, sure, decision } of expected) {
      expect(whyFlagged({ ...BASE, p })).toMatchObject({ sure, decision });
    }
  });

  it("keeps a trimmed reason and drops one that trims to nothing", () => {
    expect(whyFlagged({ ...BASE, reason: "  " })?.reason).toBeNull();
    expect(whyFlagged({ ...BASE, reason: " A move. " })?.reason).toBe("A move.");
  });
});

describe("WhyFlaggedSheet", () => {
  it("renders the trigger text and keeps its touch target", () => {
    const html = renderSheet();
    expect(html).toContain("Why we flagged this");
    expect(html).toContain("min-h-11");
  });

  it("turns the dialog it renders into a bottom sheet below 860px and a panel above", () => {
    const className = sheetContent().props.className ?? "";
    expect(className).toContain("max-[859px]:top-auto max-[859px]:bottom-0");
    expect(className).toContain("sm:max-w-lg");
  });

  it("leaves focus handling to Base UI defaults on both the dialog and its content", () => {
    const content = sheetContent();
    expect(content.props.finalFocus).toBeUndefined();
    expect(content.props.initialFocus).toBeUndefined();
    const dialog = findElement(WhyFlaggedSheet({ why: WHY }), Dialog);
    if (dialog === null) throw new Error("WhyFlaggedSheet rendered no Dialog");
    expect((dialog.props as Record<string, unknown>).modal).toBeUndefined();
  });

  it("shows what was compared, how sure the decision was, the decision and the reason", () => {
    const body = contentBody();
    expect(body).toContain('data-verdict-id="v-1"');
    expect(body).toContain("95%");
    expect(body).toContain("Flagged");
    for (const field of COMPARED) expect(body).toContain(field.value);
    expect(body).toContain("Our read: A move.");
  });

  it("drops the reason paragraph when Jev stored no reason", () => {
    const body = contentBody({ ...WHY, reason: null });
    expect(body).not.toContain("why-flagged-reason");
  });
});
