import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const publicAuxSurface = [
  "app/routes/privacy.tsx",
  "app/routes/terms.tsx",
  "app/routes/share.$token.tsx",
  "app/routes/not-found.tsx",
  "app/root.tsx",
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

const auxClasses = Array.from(publicAuxSurface.matchAll(/className=(?:"([^"]+)"|{`([^`]+)`})/g)).flatMap((match) =>
  (match[1] ?? match[2])
    .split(/\s+/)
    .map((className) => className.replace(/\$\{[^}]+\}/g, "").trim())
    .filter(Boolean),
);

describe("public auxiliary rebuild", () => {
  it("uses the fresh auxiliary page frames", () => {
    expect(publicAuxSurface).toContain('className="f9-legal-page"');
    // The share page frame gained a PDF-variant modifier (P2, 2026-07-13),
    // so accept the plain literal or a template literal rooted in the frame.
    expect(publicAuxSurface).toMatch(
      /className=(?:"f9-share-page"|\{`f9-share-page[^`]*`\})/,
		);
    expect(publicAuxSurface).toContain('className="f9-error-page"');
    expect(auxClasses).not.toEqual(
      expect.arrayContaining([
        "site-shell",
        "site-header",
        "share-shell",
        "share-header",
        "error-shell",
        "error-card",
        "content-card",
        "button-primary",
        "button-secondary",
        "section-label",
        "eyebrow",
        "muted-text",
      ]),
    );
  });

  it("keeps stale launch framing out of auxiliary pages", () => {
    expect(publicAuxSurface).not.toMatch(/pilot|self-serve|not live|fit review|Meta ads tracking beta/i);
  });

  it("keeps terms aligned with support-backed billing truth", () => {
    expect(publicAuxSurface).toContain("Plan changes and");
    expect(publicAuxSurface).toContain("cancellation stay backed by signed-in support cases");
    expect(publicAuxSurface).toContain("team-seat changes may require");
    expect(publicAuxSurface).toContain("owner confirmation");
    expect(publicAuxSurface).toContain("applicable billing and support policy");
    expect(publicAuxSurface).not.toMatch(/purchases are final|refunds cannot be made/i);
    expect(publicAuxSurface).not.toContain("100% customer satisfaction");
  });
});
