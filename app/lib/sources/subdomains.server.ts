import type { AppEnv } from "~/lib/env.server";
import { ensureDb } from "~/lib/data/d1.server";
import { registrableDomainFromLandingPage } from "~/lib/competitor-website";
import type {
  SourceAdapter,
  SourceChange,
  SourceFetchContext,
  SourceFetchResult,
  SourceSnapshotInput,
  SourceSnapshotRecord,
} from "~/lib/sources/types";
import { fetchSubdomains } from "~/lib/sources/subdomains/subdomain-signals.server";
import {
  diffSubdomainSnapshots,
  type SubdomainSnapshotPayload,
} from "~/lib/sources/subdomains/subdomain-snapshot.server";
import { SubdomainsSection } from "~/components/sources/subdomains";

/**
 * New web addresses (subdomains via crt.sh) source adapter — issue #2198.
 *
 * Fetches Certificate Transparency data from crt.sh for the competitor's
 * registrable domain, normalizes/classifies subdomains, and diffs against
 * the previous snapshot. Only new public names emit alerts; internal names
 * are stored but never alert. The first snapshot is a baseline (no alerts).
 *
 * No credentials are required (crt.sh is public); `requiresEnv` always
 * returns true so the adapter is enabled on every plan that includes it.
 */

export const subdomainsAdapter: SourceAdapter = {
  id: "subdomains",
  label: "New web addresses",
  kind: "signal",
  implemented: true,
  cadence: "daily",
  requiresEnv: () => true,

  async fetch(env: unknown, competitor: SourceFetchContext): Promise<SourceFetchResult> {
    const appEnv = env as AppEnv;
    const domain = await resolveRegistrableDomain(appEnv, competitor.competitorId);
    if (!domain) {
      return { unavailable: true, reason: "no_domain" };
    }

    const result = await fetchSubdomains(domain);
    if ("unavailable" in result && result.unavailable) {
      return { unavailable: true, reason: result.reason };
    }

    const payload: SubdomainSnapshotPayload = {
      domain,
      names: result.names,
      truncated: result.truncated,
    };

    return { payload };
  },

  diff(prev: SourceSnapshotRecord | null, next: SourceSnapshotInput): SourceChange[] {
    return diffSubdomainSnapshots(prev, next);
  },

  Section: SubdomainsSection,
};

/**
 * Look up the competitor's registrable domain from the watchlist's
 * `target_id` (the normalized website URL). Returns null when the
 * watchlist is missing or the URL does not resolve to a public domain.
 */
async function resolveRegistrableDomain(env: AppEnv, watchlistId: string): Promise<string | null> {
  try {
    const row = await ensureDb(env)
      .prepare("SELECT target_id FROM watchlist WHERE id = ?")
      .bind(watchlistId)
      .first<{ target_id: string }>();
    if (!row?.target_id) return null;
    return registrableDomainFromLandingPage(row.target_id);
  } catch {
    return null;
  }
}
