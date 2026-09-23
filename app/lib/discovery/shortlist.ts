import type { Candidate, Evidence, GeneratorKey } from "./types";

export const SHORTLIST_TOP = 20;

export const GENERATOR_ORDER: readonly GeneratorKey[] = ["news", "hn", "ads"];

export interface ShortlistEntry {
  name: string;
  domain?: string;
  evidence: Evidence[];
  generators: GeneratorKey[];
  publishers: string[];
  slot: "top" | "guaranteed";
}

interface Group {
  name: string;
  domain: string | undefined;
  evidence: Evidence[];
  nameKeys: ReadonlySet<string>;
}

interface Scored {
  group: Group;
  generators: GeneratorKey[];
  publishers: string[];
}

function nameKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function hostKey(value: string): string {
  const host = value.toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}

function publisherOf(sourceUrl: string): string | null {
  try {
    return hostKey(new URL(sourceUrl).hostname);
  } catch {
    return null;
  }
}

function generatorsOf(group: Group): GeneratorKey[] {
  const present = new Set(group.evidence.map((item) => item.generator));
  return GENERATOR_ORDER.filter((key) => present.has(key));
}

function publishersOf(group: Group): string[] {
  const found = new Set<string>();
  for (const item of group.evidence) {
    const publisher = publisherOf(item.sourceUrl);
    if (publisher !== null) found.add(publisher);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

function buildGroups(candidates: readonly Candidate[]): Group[] {
  const groups: Group[] = [];
  for (const candidate of candidates) {
    const key = nameKey(candidate.name);
    if (key === "") continue;
    const domainKey = candidate.domain === undefined ? null : hostKey(candidate.domain);
    const matchIndex = groups.findIndex((group) => {
      const byDomain =
        domainKey !== null && group.domain !== undefined && hostKey(group.domain) === domainKey;
      return byDomain || group.nameKeys.has(key);
    });
    const existing = matchIndex >= 0 ? groups[matchIndex] : undefined;
    if (existing === undefined) {
      groups.push({
        name: candidate.name,
        domain: candidate.domain,
        evidence: [...candidate.evidence],
        nameKeys: new Set([key]),
      });
    } else {
      groups[matchIndex] = {
        name: existing.name,
        domain: existing.domain ?? candidate.domain,
        evidence: [...existing.evidence, ...candidate.evidence],
        nameKeys: new Set([...existing.nameKeys, key]),
      };
    }
  }
  return groups;
}

function toEntry(scored: Scored, slot: ShortlistEntry["slot"]): ShortlistEntry {
  return {
    name: scored.group.name,
    domain: scored.group.domain,
    evidence: [...scored.group.evidence],
    generators: scored.generators,
    publishers: scored.publishers,
    slot,
  };
}

function isSoleGenerator(generators: GeneratorKey[], key: GeneratorKey): boolean {
  return generators.length === 1 && generators[0] === key;
}

export function shortlist(candidates: readonly Candidate[]): ShortlistEntry[] {
  const scored: Scored[] = buildGroups(candidates).map((group) => ({
    group,
    generators: generatorsOf(group),
    publishers: publishersOf(group),
  }));

  const sorted = [...scored].sort((a, b) => {
    if (b.generators.length !== a.generators.length) return b.generators.length - a.generators.length;
    if (b.publishers.length !== a.publishers.length) return b.publishers.length - a.publishers.length;
    return b.group.evidence.length - a.group.evidence.length;
  });

  const top = sorted.slice(0, SHORTLIST_TOP);
  const entries = top.map((item) => toEntry(item, "top"));
  const placed = new Set<Scored>(top);

  for (const key of GENERATOR_ORDER) {
    if (entries.some((entry) => isSoleGenerator(entry.generators, key))) continue;
    const next = sorted.find((item) => !placed.has(item) && isSoleGenerator(item.generators, key));
    if (next === undefined) continue;
    placed.add(next);
    entries.push(toEntry(next, "guaranteed"));
  }

  return entries;
}
