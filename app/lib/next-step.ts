const NEXT_STEP: Readonly<Record<string, string>> = {
  pricing: "Compare it with your own pricing.",
  offer: "Decide whether your customers will notice it and whether to answer.",
  launch: "Check whether it overlaps with what you are building.",
  removal: "See whether their customers now have a reason to look at you.",
  copy: "Read how they now describe themselves and compare it with how you do.",
  breakage: "Their page looks broken. Worth a look if you compete on reliability.",
  unintended: "This looks accidental. It needs no action unless it stays.",
};

export function nextStepLine(kind: string | null | undefined): string | null {
  if (kind === null || kind === undefined) return null;
  return Object.hasOwn(NEXT_STEP, kind) ? (NEXT_STEP[kind] ?? null) : null;
}
