import { expect, type Page } from "@playwright/test";

function faceProbe(args: { family: string; weight?: number } | { selector: string }): true | string {
  let family: string | undefined;
  let weight: number | undefined;
  if ("selector" in args) {
    const el = document.querySelector(args.selector);
    if (el === null) return `no element matches ${args.selector}`;
    const style = getComputedStyle(el);
    family = style.fontFamily.split(",")[0].trim().replaceAll('"', "");
    weight = Number(style.fontWeight);
  } else {
    family = args.family;
    weight = args.weight;
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

    const [low, high] = face.weight.split(" ").map(Number);
    if (weight >= low && weight <= (high ?? low)) return true;
    misses.push(`"${face.weight}" does not cover ${weight}`);
  }
  return misses.length > 0 ? misses.join("; ") : `no ${family} face in document.fonts`;
}

export function expectFaceLoaded(page: Page, family: string, weight?: number) {
  return expect
    .poll(() => page.evaluate(faceProbe, { family, weight }), {
      message: `${family} ${weight ?? "any-weight"} face`,
    })
    .toBe(true);
}
