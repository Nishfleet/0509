import { describe, expect, it } from "vitest";

import { decodeHtmlEntities } from "../../app/lib/html";

describe("decodeHtmlEntities", () => {
  it.each([
    ["Women&#x27;s Sale", "Women's Sale"],
    ["Gym Clothes &amp; Workout Clothes", "Gym Clothes & Workout Clothes"],
    ["Pro &mdash; 12 &#8364;", "Pro — 12 €"],
    ["It&rsquo;s &copy; 2026 &ndash; 5&euro; &hellip;", "It’s © 2026 – 5€ …"],
    ["&lt;b&gt; &quot;hi&quot; &apos;x&apos;", "<b> \"hi\" 'x'"],
    ["plain text", "plain text"],
    ["&#0; &#1114112; &bogus;", "&#0; &#1114112; &bogus;"],
  ])("turns %j into %j", (input, expected) => {
    expect(decodeHtmlEntities(input)).toBe(expected);
  });

  it("decodes one level only, so a page that prints &amp;lt; keeps what it shows", () => {
    expect(decodeHtmlEntities("write &amp;lt; in HTML")).toBe("write &lt; in HTML");
  });
});
