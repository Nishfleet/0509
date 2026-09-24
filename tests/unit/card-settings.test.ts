import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SearchSetting } from "../../app/components/card-settings";

describe("SearchSetting", () => {
  it("while unlisted, spells out what listing exposes and needs a ticked box to submit", () => {
    const html = renderToStaticMarkup(createElement(SearchSetting, { indexable: false }));
    expect(html).toContain("Your card is unlisted.");
    expect(html).toContain("Anyone can find it by searching");
    expect(html).toContain("every competitor you track");
    expect(html).toContain("days or weeks to drop it");
    const checkbox = html.slice(html.indexOf('<input type="checkbox"'));
    const tag = checkbox.slice(0, checkbox.indexOf(">"));
    expect(tag).toContain('name="understood"');
    expect(tag).toContain("required");
    expect(html).toContain('name="intent" value="list"');
    expect(html).toContain("Let search engines find my card");
  });

  it("while listed, says so and offers one way back to unlisted", () => {
    const html = renderToStaticMarkup(createElement(SearchSetting, { indexable: true }));
    expect(html).toContain("Search engines can find your card.");
    expect(html).toContain('name="intent" value="unlist"');
    expect(html).toContain("Make it unlisted again");
    expect(html).not.toContain('type="checkbox"');
  });
});
