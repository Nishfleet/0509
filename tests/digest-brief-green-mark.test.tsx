// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import { DesignedDigestBrief } from "~/components/digest-intelligence";

function shippedAnnouncementSelector() {
  const css = readFileSync("app/app.css", "utf8");
  const sectionStart = css.indexOf("BL-032 — Briefs");
  expect(sectionStart, "the BL-032 Briefs stylesheet section must exist").toBeGreaterThan(-1);
  const sectionCommentStart = css.lastIndexOf("/*", sectionStart);
  expect(sectionCommentStart, "the BL-032 Briefs section must have its owner header").toBeGreaterThan(
    -1,
  );
  const scoped = css.slice(sectionCommentStart).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = topLevelCssRules(scoped).filter(
    ({ selector, body }) =>
      /\.f9-wk-ins/.test(selector) && /background:\s*var\(--green\)/.test(body),
  );
  expect(rules, "exactly one BL-032 rule may paint the announcement green").toHaveLength(1);
  return rules[0].selector.trim().replace(/\s+/g, " ");
}

function topLevelCssRules(css: string) {
  const rules: Array<{ selector: string; body: string }> = [];
  let depth = 0;
  let selectorStart = 0;
  let selector = "";
  let bodyStart = 0;

  for (let index = 0; index < css.length; index += 1) {
    if (css[index] === "{") {
      if (depth === 0) {
        selector = css.slice(selectorStart, index).trim();
        bodyStart = index + 1;
      }
      depth += 1;
    } else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        if (selector && !selector.startsWith("@")) {
          rules.push({ selector, body: css.slice(bodyStart, index) });
        }
        selectorStart = index + 1;
      }
    }
  }

  return rules;
}

let greenSelector = "";

beforeAll(() => {
  greenSelector = shippedAnnouncementSelector();
});

function item(id: string, before: string, now: string, from: string, to: string) {
  return {
    id,
    title: `${id} offer changed`,
    summary: "The stored offer moved.",
    eventType: "landing_page_offer_changed",
    watchlistName: id === "newest" ? "Rival Labs" : "Older Labs",
    createdAt: now,
    metadata: {
      from,
      to,
      beforeCapturedAt: before,
      confirmedAt: now,
      proofCaptureId: `proof-${id}`,
      priorityScore: id === "older" ? 99 : 60,
    },
  };
}

function render(items: ReturnType<typeof item>[]) {
  document.body.innerHTML = renderToStaticMarkup(
    createElement(DesignedDigestBrief, {
      id: "brief",
      periodStart: "2026-07-20T00:00:00.000Z",
      periodEnd: "2026-07-28T00:00:00.000Z",
      createdAt: "2026-07-28T05:09:00.000Z",
      items,
      allItems: items,
    }),
  );
  return document.body;
}

describe("the Briefs announcement green", () => {
  it("lets long captured values wrap inside the Briefs-owned scope", () => {
    const css = readFileSync("app/app.css", "utf8");
    const sectionStart = css.indexOf("BL-032 — Briefs");
    const sectionCommentStart = css.lastIndexOf("/*", sectionStart);
    const scoped = css.slice(sectionCommentStart).replace(/\/\*[\s\S]*?\*\//g, "");
    const insertionRule = topLevelCssRules(scoped).find(
      ({ selector }) => selector.trim() === ".f9-wk-brief .f9-wk-ins",
    );
    const announcementRule = topLevelCssRules(scoped).find(
      ({ selector }) => selector.trim() === ".f9-wk-brief-announcement-line",
    );

    expect(insertionRule?.body).toMatch(/overflow-wrap:\s*anywhere/);
    expect(insertionRule?.body).toMatch(/white-space:\s*normal/);
    expect(announcementRule?.body).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("resolves the shipped selector against exactly the newest complete comparison", () => {
    const body = render([
      item(
        "older",
        "2026-07-24T04:00:00.000Z",
        "2026-07-25T04:00:00.000Z",
        "₹1,499",
        "₹1,299",
      ),
      item(
        "newest",
        "2026-07-26T04:00:00.000Z",
        "2026-07-27T04:00:00.000Z",
        "₹999",
        "₹799",
      ),
    ]);

    const painted = body.querySelectorAll(greenSelector);
    expect(painted).toHaveLength(1);
    expect(painted[0].tagName.toLowerCase()).toBe("ins");
    expect(painted[0].textContent).toBe("₹799");
    expect(painted[0].closest(".f9-wk-brief-announcement")?.classList).toContain(
      "is-newest",
    );
    expect(body.querySelectorAll(".f9-wk-brief-change.is-newest")).toHaveLength(1);
  });

  it("paints no announcement when the brief has no complete comparison", () => {
    const incomplete = item(
      "incomplete",
      "2026-07-28T05:00:00.000Z",
      "2026-07-28T04:00:00.000Z",
      "Before",
      "After",
    );
    const body = render([incomplete]);

    expect(body.querySelectorAll(greenSelector)).toHaveLength(0);
    expect(body.querySelectorAll(".f9-wk-brief-announcement")).toHaveLength(0);
  });
});

describe("only decision candidates may own proof shapes (remediation)", () => {
  it("a pending item with a complete pair renders no diff, no announcement, and an honest headline", () => {
    const base = item(
      "pending",
      "2026-07-26T04:00:00.000Z",
      "2026-07-27T04:00:00.000Z",
      "₹999",
      "₹799",
    );
    const pending = {
      ...base,
      metadata: {
        ...base.metadata,
        proofCaptureId: undefined,
        status: "proof_pending",
      },
    } as unknown as Parameters<typeof render>[0][number];
    const body = render([pending]);

    expect(body.querySelectorAll(greenSelector)).toHaveLength(0);
    expect(body.querySelector(".f9-wk-brief-announcement")).toBeNull();
    expect(body.querySelectorAll(".f9-wk-brief-change")).toHaveLength(0);
    expect(body.textContent).not.toContain("Nothing changed in this window");
    expect(body.textContent).toContain("No verified finding this window");
  });
});
