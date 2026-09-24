import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The deployment_status lighthouse job grades https://0509.io/ against a 1500ms
// LCP budget on simulated 4G. Run 35826214144 measured the h1 at 1756ms because
// the headline waited on a second request for the 77KB display face. The
// landing document has to carry its own faces, or that round trip comes back.

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const html = readFileSync(join(REPO_ROOT, "public/index.html"), "utf8");

describe("landing LCP critical path", () => {
  it("ships the three landing faces inside the document", () => {
    const faces = [...html.matchAll(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g)];
    expect(faces).toHaveLength(3);
    for (const face of faces) {
      const bytes = Buffer.from(face[1], "base64");
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("wOF2");
      // The full Bricolage file is 77KB. A face this large is the round trip
      // the budget cannot afford, even after base64.
      expect(bytes.length).toBeLessThan(12_000);
    }
    expect(Buffer.byteLength(html)).toBeLessThan(40_000);
  });

  it("does not request a stylesheet or a font file before first paint", () => {
    expect(html).not.toContain("/fonts/");
    expect(html).not.toContain("landing.css");
    expect(html).not.toContain('rel="stylesheet"');
    expect(html).not.toContain('rel="preload"');
    expect(html).toContain('font-family: "Bricolage Grotesque"');
    expect(html).toContain('font-family: "Instrument Sans"');
    expect(html).toContain('font-family: "IBM Plex Mono"');
  });
});
