import { normaliseName } from "./types";

const FIRST_WORD_STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "do", "does", "every",
  "for", "from", "how", "if", "in", "into", "is", "it", "its", "just", "like",
  "most", "more", "my", "new", "no", "not", "of", "on", "or", "our", "out",
  "over", "so", "than", "that", "the", "their", "them", "then", "there",
  "these", "they", "this", "those", "to", "top", "under", "up", "vs", "versus",
  "we", "what", "when", "where", "which", "who", "why", "with", "you", "your",
]);

const GENERIC_NOUNS = new Set([
  "alternative", "alternatives", "brand", "brands", "business", "companies",
  "company", "competitor", "competitors", "dupe", "dupes", "founder",
  "founders", "guide", "interview", "list", "marketing", "news", "podcast",
  "press", "review", "reviews", "roundup", "team", "update",
]);

export function cleanCandidateName(raw: string): string | null {
  let s = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^\d{1,3}\s*[.\)\-–:x]\s*/i, "").trim();
  const cut = s.search(/\s[—–|·]|:|\s\(|\bvs\.?\b|\breview\b/i);
  if (cut > 0) s = s.slice(0, cut).trim();
  s = s.replace(/^[\p{P}\p{S}\s]+|[.,;:!?"”'’]+$/gu, "").trim();
  if (s.length < 2 || s.length > 60) return null;
  const words = s.split(" ");
  if (words.length > 6) return null;
  if (/https?|www\.|@/.test(s)) return null;
  if (!/\p{L}/u.test(s)) return null;
  const first = words[0]!.toLowerCase();
  if (FIRST_WORD_STOP.has(first) && first !== "the") return null;
  if (words.every((w) => FIRST_WORD_STOP.has(w.toLowerCase()))) return null;
  if (words.length === 1 && GENERIC_NOUNS.has(first)) return null;
  return s;
}

export function stripPublisherSuffix(title: string): string {
  const i = title.lastIndexOf(" - ");
  return i > 0 ? title.slice(0, i) : title;
}

const LEAD_NAME = /^[A-Z0-9][\w.'&-]*(?:\s+[A-Z0-9][\w.'&-]*){0,3}/;
const SEPARATOR = /^\s*(?:,|and|&|\+)\s*/;

export function titleLeadListNames(title: string, subjectName: string): string[] {
  const head = stripPublisherSuffix(title).trim();
  if (!/,|\s+and\s+|\s*&\s*/.test(head)) return [];
  const self = normaliseName(subjectName);
  const names: string[] = [];
  let rest = head;
  while (rest.length > 0) {
    const m = LEAD_NAME.exec(rest);
    if (!m) break;
    const cleaned = cleanCandidateName(m[0]);
    if (cleaned) names.push(cleaned);
    rest = rest.slice(m[0].length);
    const sep = SEPARATOR.exec(rest);
    if (!sep || !/^[A-Z0-9]/.test(rest.slice(sep[0].length))) break;
    rest = rest.slice(sep[0].length);
  }
  const kept = names.filter((name) => normaliseName(name) !== self);
  return names.length >= 2 ? kept : [];
}

export function versusNames(title: string, subjectName: string): string[] {
  const head = stripPublisherSuffix(title);
  const m = /\bvs\.?\b/i.exec(head);
  if (!m) return [];
  const self = normaliseName(subjectName);
  return [head.slice(0, m.index), head.slice(m.index + m[0].length)]
    .map((part) => cleanCandidateName(part))
    .filter((name): name is string => !!name && normaliseName(name) !== self);
}

export function likeListNames(title: string, subjectName: string): string[] {
  const head = stripPublisherSuffix(title);
  const m = /\b(?:brands?|labels?|companies|names)\s+like\s+(.+?)$/i.exec(head);
  if (!m) return [];
  const self = normaliseName(subjectName);
  return m[1]
    .split(/\s*,\s*|\s+and\s+|\s*&\s*/)
    .map((part) => cleanCandidateName(part.replace(/^(?:and|&|\+)\s+/i, "")))
    .filter((name): name is string => !!name && normaliseName(name) !== self);
}

export function namesFromTitle(title: string, subjectName: string): string[] {
  const found = new Map<string, string>();
  for (const name of [...titleLeadListNames(title, subjectName), ...versusNames(title, subjectName), ...likeListNames(title, subjectName)]) {
    const norm = normaliseName(name);
    if (!found.has(norm)) found.set(norm, name);
  }
  return [...found.values()];
}
