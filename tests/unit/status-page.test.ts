import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusPage } from "../../app/components/status-page";

describe("StatusPage", () => {
  it("says it is having trouble when the check fails", () => {
    const html = renderToStaticMarkup(
      createElement(StatusPage, { working: false, checkedAt: "2026-10-12T12:00:00.000Z" }),
    );
    expect(html).toContain("is having trouble right now.");
    expect(html).not.toContain("are working");
  });

  it("says it is working and shows the UTC check time when the check passes", () => {
    const html = renderToStaticMarkup(
      createElement(StatusPage, { working: true, checkedAt: "2026-10-12T12:00:00.000Z" }),
    );
    expect(html).toContain("are working");
    expect(html).toContain("2026-10-12 12:00:00 UTC");
  });
});
