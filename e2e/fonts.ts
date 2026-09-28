import { expect, type Page } from "@playwright/test";

// Deferred @font-face: since #5634 the brand faces stay "unloaded" until
// something renders in them. document.fonts.check(...) can report a match
// while a face is still loading, and document.fonts.ready only waits for loads
// already in flight, so neither proves a face arrived — the face's own
// status === "loaded", polled, is the assertion that survives deferral
// (0509#5709, 0509#5715).
//
// Passed straight to page.evaluate: the body may reference only its own
// argument — nothing module-scope crosses into the browser.
export function faceLoadedProbe({ family, weight }: { family: string; weight?: number }): boolean {
  return Array.from(document.fonts).some((face) => {
    if (face.family.replaceAll('"', "") !== family || face.status !== "loaded") return false;
    if (weight === undefined) return true;
    // face.weight is the @font-face descriptor: a single "400" or a range
    // like "700 800"; a face counts when the asked weight falls inside it.
    const [low, high] = face.weight.split(" ").map(Number);
    return weight >= low && weight <= (high ?? low);
  });
}

// With a weight, the face covering that weight must be loaded; without one,
// any loaded face of the family answers. A descriptor that will not parse
// (NaN bounds) counts as not loaded, so a changed @font-face fails loud
// instead of passing vacuously.
export function expectFaceLoaded(page: Page, family: string, weight?: number) {
  return expect
    .poll(() => page.evaluate(faceLoadedProbe, { family, weight }), {
      message: `${family} ${weight ?? "any"} face did not reach status "loaded"`,
    })
    .toBe(true);
}
