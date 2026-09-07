export function stablePublicId(prefix: string, parts: Array<string | number | null | undefined>) {
  const seed = parts
    .map((part) => (typeof part === "undefined" || part === null ? "" : String(part)))
    .join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}
