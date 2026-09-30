const MAX_CLAIMED_NAME = 40;

export function claimedNameFor(clientName: string | undefined): string | null {
  const name = (clientName ?? "")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (name === "") return null;
  const chars = Array.from(new Intl.Segmenter().segment(name), (part) => part.segment);
  return chars.length > MAX_CLAIMED_NAME ? `${chars.slice(0, MAX_CLAIMED_NAME - 1).join("")}…` : name;
}
