import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const route = readFileSync("app/routes/app.collections.tsx", "utf8");
const components = [
  "app/components/collections/collection-details-section.tsx",
  "app/components/collections/collection-evidence-workspace.tsx",
  "app/components/collections/collection-external-proof-section.tsx",
].map((file) => readFileSync(file, "utf8")).join("\n");
const presentation = `${route}\n${components}`;
const css = readFileSync("app/app.css", "utf8");
const marker = "/* === BL-033a collections (landing language) === */";

function sourceBetween(start: string, end: string) {
  const from = route.indexOf(start);
  const to = route.indexOf(end, from + start.length);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return route.slice(from, to);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe("BL-033a presentation-only boundary", () => {
  it("keeps the collections loader and action byte-for-byte frozen", () => {
    expect(
      sha256(sourceBetween("export async function loader", "export async function action")),
    ).toBe("326257173df7ee419c9bad2966eafab290ff4d8b773e2ac98b612d7314ba9a6b");
    expect(
      sha256(
        sourceBetween(
          "export async function action",
          "export default function CollectionsRoute",
        ),
      ),
    ).toBe("2a87cef4cac04ebbf1fc686bafb13b77152ea35a5515583323f3019ac62fde2c");
  });

  it("uses the P0 working primitives and leaves the plate/card language behind", () => {
    for (const primitive of [
      "<WorkingHeader",
      "<RuledList",
      "<RuledRow",
      "<DetailPane",
      "<FeedbackStrip",
    ]) {
      expect(presentation).toContain(primitive);
    }
    for (const orphan of [
      "f9-ed-collection-layout",
      "f9-ed-collection-item",
      "f9-ed-status-strip",
      "f9-ed-specimen",
      "f9-ed-evidence-plate",
      "f9-ed-disclosure",
      "f9-ed-switch",
    ]) {
      expect(presentation).not.toContain(orphan);
    }
    expect(components).toContain("key={selectedItem.id}");
  });
});

describe("BL-033a route-owned CSS", () => {
  const section = css.slice(css.indexOf(marker));

  it("is one clearly headed section appended after every older package", () => {
    expect(css.match(/\/\* === BL-033a collections \(landing language\) === \*\//g)).toHaveLength(1);
    expect(css.indexOf(marker)).toBeGreaterThan(css.indexOf("BL-030 — the landing-language workspace layer"));
    expect(section.length).toBeGreaterThan(2_000);
  });

  it("uses one 1px rule, square corners, no elevation, and no decorative green", () => {
    const withoutComments = section.replace(/\/\*[\s\S]*?\*\//g, "");
    const borderWidths = new Set(
      [...withoutComments.matchAll(/border(?:-(?:top|right|bottom|left))?:\s*([^;]+);/g)]
        .map((match) => match[1].trim())
        .filter((value) => value !== "0")
        .map((value) => value.split(/\s+/)[0]),
    );
    expect([...borderWidths]).toEqual(["1px"]);
    const radii = [...withoutComments.matchAll(/border-radius:\s*([^;]+);/g)].map(
      (match) => match[1].trim(),
    );
    expect(radii.length).toBeGreaterThan(0);
    expect(radii.filter((value) => value !== "0")).toEqual([]);
    const shadows = [...withoutComments.matchAll(/box-shadow:\s*([^;]+);/g)].map(
      (match) => match[1].trim(),
    );
    expect(shadows.filter((value) => value !== "none")).toEqual([]);
    expect(withoutComments).not.toMatch(/var\(--green\b|var\(--ed-accent\b|#[0-9a-f]{3,8}/i);
  });

  it("deletes only the orphaned BL-014 collections selectors", () => {
    for (const orphan of [
      ".f9-ed-disclosure",
      ".f9-ed-switch",
      ".f9-ed-collection-layout",
      ".f9-ed-collection-item",
    ]) {
      expect(css).not.toContain(orphan);
    }
  });
});
