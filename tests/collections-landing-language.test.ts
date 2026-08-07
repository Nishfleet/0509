import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import ts from "typescript";
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
const routeSourceFile = ts.createSourceFile(
  "app.collections.tsx",
  route,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function sourceBetween(start: string, end: string) {
  const from = route.indexOf(start);
  const to = route.indexOf(end, from + start.length);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return route.slice(from, to);
}

function routeOwnedCssSection() {
  const markerIndex = css.indexOf(marker);
  expect(markerIndex, "BL-033a CSS section marker is missing").toBeGreaterThan(-1);
  return css.slice(markerIndex);
}

function canonicalAst(node: ts.Node): unknown[] {
  const value =
    ts.isIdentifier(node) ||
    ts.isPrivateIdentifier(node) ||
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    ts.isRegularExpressionLiteral(node) ||
    ts.isTemplateLiteralToken(node)
      ? node.text
      : null;
  return [
    node.kind,
    value,
    node.getChildren(routeSourceFile).map((child) => canonicalAst(child)),
  ];
}

function exportedFunctionFingerprint(name: string) {
  const declaration = routeSourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === name &&
      ts.getModifiers(statement)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ),
  );
  expect(declaration, `exported ${name} function is missing`).toBeDefined();
  if (!declaration) throw new Error(`exported ${name} function is missing`);

  return createHash("sha256")
    .update(JSON.stringify(canonicalAst(declaration)))
    .digest("hex");
}

describe("BL-033a presentation-only boundary", () => {
  it("keeps the loader and action structure stable across formatting changes", () => {
    expect(exportedFunctionFingerprint("loader")).toBe(
      "d0ec75eed0423dbfbda0687a679d140a7ab6b2965edd2b85f52de773d08d6a7b",
    );
    expect(exportedFunctionFingerprint("action")).toBe(
      "462bcd459e123137cccaf6b9197aa845285bf0a8f18d2f8fd18d45a8975d44cd",
    );
  });

  it("keeps presentation code out of the existing loader and action contracts", () => {
    const loader = sourceBetween("export async function loader", "export async function action");
    const action = sourceBetween(
      "export async function action",
      "export default function CollectionsRoute",
    );

    for (const contract of [
      "requireWorkspaceSession(env, request)",
      "listCollections(env, workspaceUserId)",
      "getCollection(env, id, workspaceUserId)",
      "listCollectionItems(env, id)",
      "getUserPlan(env, workspaceUserId)",
      "hiddenByAdvertiserFilter",
    ]) {
      expect(loader).toContain(contract);
    }
    for (const contract of [
      '"create-collection"',
      "createCollectionWithinLimit",
      '"update-item"',
      "updateCollectionItem",
      '"add-external-proof"',
      "addExternalProofToCollection",
      '"delete-collection"',
      "deleteCollection",
      '"remove-item"',
      "deleteCollectionItem",
      '"share-collection"',
      "createShareLink",
      "requireWorkspacePlanLimit",
      "requireWorkspacePlanFeature",
    ]) {
      expect(action).toContain(contract);
    }
    for (const presentationDetail of ["<WorkingHeader", "className=", "f9-wk-"]) {
      expect(loader).not.toContain(presentationDetail);
      expect(action).not.toContain(presentationDetail);
    }
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
  it("is one clearly headed section appended after every older package", () => {
    const section = routeOwnedCssSection();
    expect(css.match(/\/\* === BL-033a collections \(landing language\) === \*\//g)).toHaveLength(1);
    expect(css.indexOf(marker)).toBeGreaterThan(css.indexOf("BL-030 — the landing-language workspace layer"));
    expect(section.length).toBeGreaterThan(2_000);
  });

  it("uses one 1px rule, square corners, no elevation, and no decorative green", () => {
    const section = routeOwnedCssSection();
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

describe("saved evidence kicker completeness (remediation T17)", () => {
  const source = readFileSync("app/components/collections/saved-evidence-item.tsx", "utf8");

  it("the bare Captured kicker is gated on both a capture time and stored content", () => {
    expect(source).toContain('"Captured — time not recorded"');
    expect(source).toContain('"Captured — content not stored"');
    expect(source).toContain("hasStoredContent");
    // The component must never pass the raw status straight into the kicker.
    expect(source).not.toContain("kicker={resolveSavedItemStatus(");
  });

  it("the list time cell never renders a bare dash for a captured item", () => {
    const workspace = readFileSync(
      "app/components/collections/collection-evidence-workspace.tsx",
      "utf8",
    );
    expect(workspace).toContain('"Capture time not recorded"');
    expect(workspace).not.toContain('return "—"');
  });
});
