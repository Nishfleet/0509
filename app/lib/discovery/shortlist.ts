import { getDomain } from "tldts";

import { normaliseName, type Candidate } from "./types";

export const SHORTLIST_LIMIT = 20;

export interface ScoredCandidate {
  candidate: Candidate;
  key: string;
  domain: string | null;
  generatorCount: number;
  publisherCount: number;
  evidenceCount: number;
  guaranteedVia: string | null;
  shortlisted: boolean;
}

function keyFor(candidate: Candidate): { key: string; domain: string | null } {
  const domain = candidate.domain ? getDomain(candidate.domain) : null;
  if (domain) return { key: `d:${domain}`, domain };
  return { key: `n:${normaliseName(candidate.name)}`, domain: null };
}

export function scoreCandidates(candidates: Candidate[]): ScoredCandidate[] {
  const merged = new Map<string, ScoredCandidate>();
  for (const candidate of candidates) {
    const { key, domain } = keyFor(candidate);
    const existing = merged.get(key);
    if (existing) {
      existing.candidate.evidence.push(...candidate.evidence);
      if (!existing.candidate.domain && candidate.domain) existing.candidate.domain = candidate.domain;
    } else {
      merged.set(key, {
        candidate: { ...candidate, evidence: [...candidate.evidence] },
        key,
        domain,
        generatorCount: 0,
        publisherCount: 0,
        evidenceCount: 0,
        guaranteedVia: null,
        shortlisted: false,
      });
    }
  }
  for (const scored of merged.values()) {
    const generators = new Set<string>();
    const publishers = new Set<string>();
    for (const ev of scored.candidate.evidence) {
      generators.add(ev.generator);
      const pub = ev.publisherDomain ?? getDomain(ev.sourceUrl);
      if (pub) publishers.add(pub);
    }
    scored.generatorCount = generators.size;
    scored.publisherCount = publishers.size;
    scored.evidenceCount = scored.candidate.evidence.length;
  }
  return [...merged.values()].sort(
    (a, b) =>
      b.generatorCount - a.generatorCount ||
      b.publisherCount - a.publisherCount ||
      b.evidenceCount - a.evidenceCount ||
      a.candidate.name.localeCompare(b.candidate.name),
  );
}

export function buildShortlist(
  candidates: Candidate[],
  limit = SHORTLIST_LIMIT,
): ScoredCandidate[] {
  const scored = scoreCandidates(candidates);
  const picked = new Set<string>();
  for (const row of scored.slice(0, limit)) picked.add(row.key);
  const allGenerators = new Set(candidates.flatMap((c) => c.evidence.map((e) => e.generator)));
  for (const generator of allGenerators) {
    const unique = scored.find(
      (row) =>
        !picked.has(row.key) &&
        row.candidate.evidence.every((e) => e.generator === generator),
    );
    if (unique) {
      unique.guaranteedVia = generator;
      picked.add(unique.key);
    }
  }
  for (const row of scored) row.shortlisted = picked.has(row.key);
  return scored;
}
