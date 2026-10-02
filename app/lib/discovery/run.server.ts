import { captureException } from "@sentry/cloudflare";
import { getDomain } from "tldts";

import type { BacklogRow } from "../data/discovery_backlog.server";
import type { DiscoveryContext, DiscoverySelf } from "../data/entity.server";
import type { DiscoveryResult } from "../data/suggestion.server";
import { takenDownAmong } from "../data/takedown.server";
import type { NoulQuestion, NoulVerdict } from "../jev/client.server";
import { askNoul, JevUnavailableError } from "../jev/client.server";
import { evidenceLine } from "./evidence-line";
import { aiGenerator } from "./generators/ai.server";
import { hnGenerator } from "./generators/hn.server";
import { resolveDomain } from "./resolve-domain.server";
import { nameKey, partitionShortlist } from "./shortlist";
import type { ShortlistEntry } from "./shortlist";
import type { Candidate, Evidence } from "./types";

const EVIDENCE_KEPT = 5;
export const JUDGE_BATCH_SIZE = 2;

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

export const IS_COMPETITOR: NoulQuestion = {
  id: "is_competitor",
  instructions:
    "Is `item` a real competitor of `self`: a company or brand that sells a substitute to the same kind of customer, so the owner of `self` would want to watch what it does? `item.evidence` is where the two were named together. Judge the business relationship the evidence shows. If `item` sells, stocks, lists, supplies, funds, owns, reports on or partners with `self`, it is not a competitor, even when it is in the same industry.",
  whenTrue:
    "It sells a substitute product or service to the same kind of customer as `self`: a customer of `self` could switch to it. Its size, age, price or business model (free, open-source, enterprise, startup, incumbent) does not matter.",
  whenFalse:
    "It is a publisher, retailer, marketplace, supplier, partner, investor, a product line of `self`, `self` itself, or an unrelated company that only shares a headline.",
};

export const IS_CREATOR_RIVAL: NoulQuestion = {
  id: "is_creator_rival",
  instructions:
    "Is `item` a real rival of `self`, a creator? A rival is a peer a viewer could watch instead of `self`: another creator or channel on the same platform courting the same audience, or a brand selling into the category `self` sells into. `item.evidence` is where the two were named together. Judge that from the evidence: an item that only carries, hosts, reports on, or sponsors `self` is a false case, while an item whose own audience or catalogue points at the same fans or buyers as `self` is a true case.",
  whenTrue: "It competes with `self` for the same audience or sells into the same category as `self`.",
  whenFalse:
    "It is a platform, publisher, sponsor, retailer, a product of `self`, `self` itself, or an unrelated name that only shares a headline.",
};

const GENERATORS = [
  { name: "hn", run: hnGenerator },
  { name: "ai", run: aiGenerator },
] as const;

export class DiscoveryUnavailableError extends Error {}

function failureMessage(reason: unknown): string {
  return (reason instanceof Error ? reason.message : String(reason)).slice(0, 300);
}

async function settledCandidates(self: DiscoverySelf): Promise<Candidate[]> {
  const subject = { name: self.name, domain: self.domain, description: self.description };
  const runs = await Promise.allSettled(GENERATORS.map((generator) => generator.run(subject)));
  const failed = runs.flatMap((run, index) =>
    run.status === "rejected" ? [{ generator: GENERATORS[index]?.name, reason: run.reason as unknown }] : [],
  );
  for (const { generator, reason } of failed) {
    console.error(JSON.stringify({ event: "discovery.generator_failed", generator, message: failureMessage(reason) }));
  }
  if (failed.length === runs.length) {
    throw new DiscoveryUnavailableError(
      `every discovery generator failed: ${failed.map((item) => `${String(item.generator)}: ${failureMessage(item.reason)}`).join("; ")}`,
    );
  }
  for (const { generator, reason } of failed) captureException(reason, { tags: { discovery_generator: generator } });
  return runs.flatMap((run) => (run.status === "fulfilled" ? run.value : []));
}

export function withBacklog(
  fresh: readonly Candidate[],
  backlog: readonly Candidate[],
): { entries: ShortlistEntry[]; rest: BacklogRow[]; promoted: string[] } {
  const { entries, rest } = partitionShortlist([...backlog, ...fresh]);
  const placed = new Set(entries.flatMap((entry) => entry.nameKeys));
  const promoted = [...new Set(backlog.map((candidate) => nameKey(candidate.name)).filter((key) => placed.has(key)))];
  return {
    entries,
    rest: rest.map((candidate) => ({
      nameKey: nameKey(candidate.name),
      name: candidate.name,
      domain: candidate.domain ?? null,
      evidence: candidate.evidence,
    })),
    promoted,
  };
}

export async function generateShortlist(
  self: DiscoverySelf,
  backlog: readonly Candidate[],
): Promise<{ shortlisted: ShortlistedCandidate[]; rest: BacklogRow[]; promoted: string[] }> {
  const merged = withBacklog(await settledCandidates(self), backlog);
  return {
    shortlisted: merged.entries.map((entry) => ({
      name: entry.name,
      domain: entry.domain ?? null,
      evidence: entry.evidence.slice(0, EVIDENCE_KEPT),
      line: evidenceLine(entry.evidence),
    })),
    rest: merged.rest,
    promoted: merged.promoted,
  };
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

export function competitorState(context: DiscoveryContext, candidate: ResolvedCandidate): unknown {
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
    reliability: { hn: "best_effort" },
  };
}

async function askCandidate(context: DiscoveryContext, candidate: ResolvedCandidate): Promise<NoulVerdict | null> {
  try {
    return await askNoul(
      context.self.workspaceId,
      context.self.kind === "creator" ? IS_CREATOR_RIVAL : IS_COMPETITOR,
      competitorState(context, candidate),
    );
  } catch (error) {
    if (!(error instanceof JevUnavailableError)) throw error;
    console.error(JSON.stringify({ event: "discovery.jev_unavailable", message: error.message }));
    return null;
  }
}

export async function judgeCandidates(
  context: DiscoveryContext,
  candidates: readonly ResolvedCandidate[],
): Promise<DiscoveryResult[]> {
  const results: DiscoveryResult[] = [];
  let available = true;
  for (const candidate of candidates) {
    const verdict: NoulVerdict | null = available ? await askCandidate(context, candidate) : null;
    available = verdict !== null;
    results.push({ ...candidate, verdict });
  }
  return results;
}

export function judgeBatches(candidates: readonly ResolvedCandidate[]): ResolvedCandidate[][] {
  return Array.from({ length: Math.ceil(candidates.length / JUDGE_BATCH_SIZE) }, (_, index) =>
    candidates.slice(index * JUDGE_BATCH_SIZE, (index + 1) * JUDGE_BATCH_SIZE),
  );
}
