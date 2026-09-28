import { expect, type Page } from "@playwright/test";

// Deferred @font-face: the brand faces stay "unloaded" until something renders
// in them, document.fonts.check(...) can report a match while a face is still
// loading, and document.fonts.ready only waits for in-flight loads — so the
// assertion that survives deferral is the face's own status === "loaded",
// polled (0509#5709, 0509#5715).
//
// faceProbe runs in the browser via page.evaluate: its body may reference only
// its own parameter — nothing module-scope crosses over. It returns true on
// the loaded face or the misses it saw, so a poll timeout prints the observed
// descriptors instead of a bare false.
function faceProbe({
  family,
  weight,
  selector,
}: {
  family?: string;
  weight?: number;
  selector?: string;
}): true | string {
  if (selector !== undefined) {
    const el = document.querySelector(selector);
    if (el === null) return `no element matches ${selector}`;
    const style = getComputedStyle(el);
    family = style.fontFamily.split(",")[0].trim().replaceAll('"', "");
    weight = Number(style.fontWeight);
  }
  if (family === undefined) return "no family asked for";
  const misses: string[] = [];
  for (const face of document.fonts) {
    if (face.family.replaceAll('"', "") !== family) continue;
    if (face.status !== "loaded") {
      misses.push(`${face.weight} is ${face.status}`);
      continue;
    }
    if (weight === undefined) return true;
    // face.weight is the @font-face descriptor: a single "400" or a range
    // like "700 800"; the face counts when the asked weight falls inside it.
    const [low, high] = face.weight.split(" ").map(Number);
    if (weight >= low && weight <= (high ?? low)) return true;
    misses.push(`"${face.weight}" does not cover ${weight}`);
  }
  return misses.length > 0 ? misses.join("; ") : `no ${family} face in document.fonts`;
}

// The face covering `weight` of `family` must report loaded; with no weight,
// any loaded face of the family answers.
export function expectFaceLoaded(page: Page, family: string, weight?: number) {
  return expect
    .poll(() => page.evaluate(faceProbe, { family, weight }), {
      message: `${family} ${weight ?? "any-weight"} face`,
    })
    .toBe(true);
}

// Element-anchored: the face the element's computed style resolves to (first
// family at the used weight) must be the loaded one.
export function expectElementFaceLoaded(page: Page, selector: string) {
  return expect
    .poll(() => page.evaluate(faceProbe, { selector }), { message: `${selector} resolved face` })
    .toBe(true);
}
