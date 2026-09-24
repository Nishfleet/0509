import { getDomain } from "tldts";

import type { DiscoveryContext, DiscoverySelf } from "../data/entity.server";
import type { DiscoveryResult } from "../data/suggestion.server";
import { takenDownAmong } from "../data/takedown.server";
import type { NoulQuestion, NoulVerdict } from "../jev/client.server";
import { askNoul, JevUnavailableError } from "../jev/client.server";
import { evidenceLine } from "./evidence-line";
import { hnGenerator } from "./generators/hn";
import { newsGenerator } from "./generators/news";
import { resolveDomain } from "./resolve-domain.server";
import { shortlist } from "./shortlist";
import type { Candidate, Evidence } from "./types";

const EVIDENCE_KEPT = 5;

export interface ShortlistedCandidate {
  name: string;
  domain: string | null;
  evidence: Evidence[];
  line: string;
}

export interface ResolvedCandidate {
  name: string;
  domain: string;
  evidence: Evidence[];
  line: string;
}

const IS_COMPETITOR: NoulQuestion = {
  id: "is_competitor",
  instructions:
    "Is `item` a real competitor of `self`: a company or brand that sells a substitute to the same kind of customer, so the owner of `self` would want to watch what it does? `item.evidence` is where the two were named together.",
  whenTrue: "It sells a substitute product or service to the same kind of customer as `self`.",
  whenFalse:
    "It is a publisher, retailer, marketplace, supplier, partner, investor, a product line of `self`, `self` itself, or an unrelated company that only shares a headline.",
};

async function settledCandidates(self: DiscoverySelf): Promise<Candidate[]> {
  const subject = { name: self.name, domain: self.domain };
  const runs = await Promise.allSettled([newsGenerator(subject), hnGenerator(subject)]);
  return runs.flatMap((run) => (run.status === "fulfilled" ? run.value : []));
}

export async function generateShortlist(self: DiscoverySelf): Promise<ShortlistedCandidate[]> {
  const entries = shortlist(await settledCandidates(self));
  return entries.map((entry) => ({
    name: entry.name,
    domain: entry.domain ?? null,
    evidence: entry.evidence.slice(0, EVIDENCE_KEPT),
    line: evidenceLine(entry.evidence),
  }));
}

async function domainOf(candidate: ShortlistedCandidate): Promise<string | null> {
  if (candidate.domain !== null) return getDomain(candidate.domain);
  const resolution = await resolveDomain(candidate.name);
  return resolution.domain;
}

export async function resolveShortlist(
  context: DiscoveryContext,
  candidates: readonly ShortlistedCandidate[],
): Promise<ResolvedCandidate[]> {
  const known = new Set([context.self.domain, ...context.knownDomains]);
  const domains = await Promise.all(candidates.map(domainOf));
  const blocked = await takenDownAmong(
    domains.filter((domain): domain is string => domain !== null && domain !== undefined),
  );
  const resolved: ResolvedCandidate[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const domain = domains[index];
    if (domain === null || domain === undefined || known.has(domain) || blocked.has(domain)) continue;
    known.add(domain);
    resolved.push({ name: candidate.name, domain, evidence: candidate.evidence, line: candidate.line });
  }
  return resolved;
}

function competitorState(context: DiscoveryContext, candidate: ResolvedCandidate): unknown {
  return {
    self: {
      name: context.self.name,
      domain: context.self.domain,
      description: context.self.description,
    },
    competitor_set: context.competitors,
    item: {
      name: candidate.name,
      domain: candidate.domain,
      evidence: candidate.evidence.map((item) => ({ source: item.sourceUrl, excerpt: item.excerpt })),
    },
    user_memory: { dismissed_domains: context.dismissedDomains },
    reliability: { news: "rss", hn: "best_effort" },
  };
}

export async function judgeCandidates(
  context: DiscoveryContext,
  candidates: readonly ResolvedCandidate[],
): Promise<DiscoveryResult[]> {
  const results: DiscoveryResult[] = [];
  let available = true;
  for (const candidate of candidates) {
    let verdict: NoulVerdict | null = null;
    if (available) {
      try {
        verdict = await askNoul(context.self.workspaceId, IS_COMPETITOR, competitorState(context, candidate));
      } catch (error) {
        if (!(error instanceof JevUnavailableError)) throw error;
        console.error(JSON.stringify({ event: "discovery.jev_unavailable", message: error.message }));
        available = false;
      }
    }
    results.push({ ...candidate, verdict });
  }
  return results;
}
