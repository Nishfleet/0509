/**
 * Sneaker-resale seed-list recall check (issue #1945), as app code.
 *
 * Replaces scripts/canary-sneaker-resale-recall.mjs and its VPS timer
 * (0509#3679, scripts-to-zero). The Worker's own 3-hourly monitoring cron
 * calls this; a regression reaches the operator through the same
 * scheduled-task failure path every other cron uses.
 *
 * Rule, unchanged from the canary: every seed-list brand must show at least
 * one verified or likely row in the public-search discovery cache.
 */
import sneakerResaleSeedList from "../../data/seed-lists/sneaker-resale.json";
import type { AppEnv } from "~/lib/env.server";
import { canonicalizeSneakerResaleDomain } from "~/lib/sneaker-resale-cohort";
import { getSneakerResaleTierByDomain } from "~/lib/sneaker-resale-cohort.server";

export type SneakerResaleRecallResult = {
  checked: number;
  covered: string[];
  missing: string[];
};

export function seedListDomains(
  list: { domains?: ReadonlyArray<{ domain?: unknown }> } = sneakerResaleSeedList,
): string[] {
  const out = new Set<string>();
  for (const entry of list.domains ?? []) {
    const domain = canonicalizeSneakerResaleDomain(entry?.domain);
    if (domain) out.add(domain);
  }
  return [...out];
}

export function evaluateSneakerResaleRecall(
  domains: readonly string[],
  tiers: ReadonlyMap<string, { verifiedCount: number; likelyCount: number }>,
): SneakerResaleRecallResult {
  const covered: string[] = [];
  const missing: string[] = [];
  for (const domain of domains) {
    const tier = tiers.get(domain);
    if (tier && tier.verifiedCount + tier.likelyCount > 0) covered.push(domain);
    else missing.push(domain);
  }
  return { checked: domains.length, covered, missing };
}

export async function checkSneakerResaleRecall(env: AppEnv): Promise<SneakerResaleRecallResult> {
  const domains = seedListDomains();
  const tiers = await getSneakerResaleTierByDomain(env, domains);
  const result = evaluateSneakerResaleRecall(domains, tiers);
  console.log("sneaker_resale_recall", { checked: result.checked, covered: result.covered.length, missing: result.missing });
  return result;
}
