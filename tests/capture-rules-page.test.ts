import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CAPTURE_VALIDITY_REASON_CODES,
  type CaptureValidityReasonCode,
} from "~/lib/capture-validity.server";
import {
  CAPTURE_RULES_PUBLIC_PATH,
  CAPTURE_VALIDITY_PUBLIC_RULES,
} from "~/lib/capture-validity-public-rules";
import { SITEMAP_PATHS } from "~/lib/seo";

const captureRulesHitsInSitemap = [...SITEMAP_PATHS].filter(
  (path) => path === "/capture-rules",
);

/**
 * Lock test for issue #1264: the /capture-rules page must list, in plain
 * language, each current CaptureValidityReasonCode so a new reason code
 * without a public line fails CI. Reads the union from
 * capture-validity.server.ts (the source of truth) and the public rules from
 * capture-validity-public-rules.ts (which the /capture-rules route renders),
 * then asserts every reason code is mapped and the route module renders the
 * rules. A mocked unit that never imports the union does not count.
 */
describe("capture-rules page lock (#1264)", () => {
  it("is registered at /capture-rules and in the sitemap", () => {
    const routeSource = readFileSync("app/routes.ts", "utf8");
    expect(routeSource).toContain(
      'route("capture-rules", "routes/capture-rules.tsx")',
    );
    expect(SITEMAP_PATHS).toContain("/capture-rules");
    expect(CAPTURE_RULES_PUBLIC_PATH).toBe("/capture-rules");
  });

  it("renders every CaptureValidityReasonCode via the public rules", () => {
    const reasonCodes: readonly CaptureValidityReasonCode[] =
      CAPTURE_VALIDITY_REASON_CODES;
    expect(reasonCodes.length).toBe(5);

    const mappedReasonCodes = new Set(
      CAPTURE_VALIDITY_PUBLIC_RULES.filter(
        (rule) => rule.gate.kind === "reason_code",
      ).map((rule) => (rule.gate as { code: string }).code),
    );

    for (const code of reasonCodes) {
      expect(
        mappedReasonCodes,
        `reason code ${code} must have a public rule on /capture-rules`,
      ).toContain(code);
    }
  });

  it("renders each public rule via the /capture-rules route module", () => {
    const routeSource = readFileSync("app/routes/capture-rules.tsx", "utf8");
    const rulesSource = readFileSync(
      "app/lib/capture-validity-public-rules.ts",
      "utf8",
    );

    // The route must import and render the public rules (not a hand-written
    // copy that can drift from the gate union).
    expect(routeSource).toContain("CAPTURE_VALIDITY_PUBLIC_RULES");
    expect(routeSource).toContain(".map((rule)");

    // Each rule's title must appear in the data module the route renders.
    for (const rule of CAPTURE_VALIDITY_PUBLIC_RULES) {
      expect(
        rulesSource,
        `rule ${rule.id} title must be in the public rules module`,
      ).toContain(rule.title);
    }
  });

  it("is linked from /trust and /compare/visualping", () => {
    const trustSource = readFileSync("app/routes/trust.tsx", "utf8");
    const compareSource = readFileSync(
      "app/routes/compare.visualping.tsx",
      "utf8",
    );

    expect(trustSource).toContain("/capture-rules");
    expect(compareSource).toContain("/capture-rules");
  });

  it("has exactly one canonical capture-rules entry in the sitemap and a 301 from /proof (#1432)", () => {
    const redirectSource = readFileSync("app/routes/proof.tsx", "utf8");

    expect(captureRulesHitsInSitemap).toEqual(["/capture-rules"]);
    expect(redirectSource).toContain("redirect(");
    expect(redirectSource).toContain("301");
    expect(redirectSource).toContain("/capture-rules");
  });
});
