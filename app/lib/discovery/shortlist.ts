import { getDomain } from "tldts";

import type { Candidate, Evidence, GeneratorKey } from "./types";

export const SHORTLIST_TOP = 20;

export const GENERATOR_ORDER: readonly GeneratorKey[] = ["news", "hn", "ads"];

export interface ShortlistEntry {
  name: string;
  domain?: string;
  evidence: Evidence[];
  nameKeys: string[];
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

export function nameKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function isSameEvidence(a: Evidence, b: Evidence): boolean {
  return a.generator === b.generator && a.sourceUrl === b.sourceUrl;
}

function hostKey(value: string): string {
  return getDomain(value) ?? value.toLowerCase();
}

function publisherOf(sourceUrl: string): string | null {
  return getDomain(sourceUrl);
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
      const additions = candidate.evidence.filter(
        (item) => !existing.evidence.some((kept) => isSameEvidence(kept, item)),
      );
      groups[matchIndex] = {
        name: existing.name,
        domain: existing.domain ?? candidate.domain,
        evidence: [...existing.evidence, ...additions],
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
    nameKeys: [...scored.group.nameKeys].sort((a, b) => a.localeCompare(b)),
    generators: scored.generators,
    publishers: scored.publishers,
    slot,
  };
}

function isSoleGenerator(generators: GeneratorKey[], key: GeneratorKey): boolean {
  return generators.length === 1 && generators[0] === key;
}

export function evidenceLine(entry: ShortlistEntry): string {
  return GENERATOR_ORDER.flatMap((key) => {
    if (!entry.generators.includes(key)) return [];
    if (key === "news") {
      const hosts = new Set(
        entry.evidence.flatMap((item) => {
          if (item.generator !== "news") return [];
          const publisher = publisherOf(item.sourceUrl);
          return publisher === null ? [] : [publisher];
        }),
      );
      const count = Math.max(1, hosts.size);
      return [`named by ${String(count)} news publisher${count !== 1 ? "s" : ""}`];
    }
    if (key === "hn") {
      const urls = new Set(
        entry.evidence.flatMap((item) => (item.generator === "hn" ? [item.sourceUrl] : [])),
      );
      return [`mentioned in ${String(urls.size)} Hacker News thread${urls.size !== 1 ? "s" : ""}`];
    }
    return ["advertises in the same category"];
  }).join(", ");
}

export function partitionShortlist(candidates: readonly Candidate[]): {
  entries: ShortlistEntry[];
  rest: Candidate[];
} {
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

  const rest: Candidate[] = sorted
    .filter((item) => !placed.has(item))
    .map((item) => ({
      name: item.group.name,
      evidence: [...item.group.evidence],
      ...(item.group.domain === undefined ? {} : { domain: item.group.domain }),
    }));

  return { entries, rest };
}

export function shortlist(candidates: readonly Candidate[]): ShortlistEntry[] {
  return partitionShortlist(candidates).entries;
}
