import { describe, expect, it } from "vitest";

import { htmlToText } from "../../../app/lib/discovery/html-text";

describe("htmlToText", () => {
  it("turns paragraph tags into line breaks and drops other tags", () => {
    expect(htmlToText('One<p>Two <a href="https://x.example">link</a><br>Three')).toBe("One\nTwo link\nThree");
  });

  it("decodes named and numeric entities", () => {
    expect(htmlToText("Tom &amp; Jerry&#x27;s &quot;bar&quot; &#39;x&#39; &gt; &lt; &#x2F;")).toBe(
      "Tom & Jerry's \"bar\" 'x' > < /",
    );
  });

  it("leaves an unknown or out-of-range entity as written", () => {
    expect(htmlToText("&bogus; &#0; &#x110000;")).toBe("&bogus; &#0; &#x110000;");
  });
});
