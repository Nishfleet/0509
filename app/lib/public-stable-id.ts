import { sha256 } from "@noble/hashes/sha2.js";

const textEncoder = new TextEncoder();

export function stablePublicId(prefix: string, parts: Array<string | number | null | undefined>) {
  const seed = parts
    .map((part) => (typeof part === "undefined" || part === null ? "" : String(part)))
    .join("|");
  const digest = sha256(textEncoder.encode(seed));
  const hash = new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getUint32(0);
  return `${prefix}_${hash.toString(36)}`;
}
