import { parse } from "tldts";

export function nameFromDomain(domain: string): string | null {
  const label = parse(domain).domainWithoutSuffix ?? "";
  const words = label.split(/[-_]+/).filter((word) => word !== "");
  if (words.length === 0) return null;
  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}
