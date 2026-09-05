import {
  domainMatchTier,
  type DomainMatchLevel,
  type DomainMatchTier,
} from "~/lib/search-domain-match";

/**
 * BET 2 three-tier badge (issue 1482) — the customer-facing confidence marker
 * for one result row. Every row that carries a `domainMatch.level` renders
 * exactly one badge: "Verified" (green), "Likely" (amber), or "Unmatched"
 * (grey). Rows without domain-match metadata (legacy v1 path) render none.
 *
 * The badge is the VISIBLE tier marker the bet2-live-verification canary
 * counts (`class="f9-tier-badge is-<tier>"`), so the markup contract must
 * stay stable: one badge span per row, tier in the `is-` class.
 */
const TIER_LABEL: Record<DomainMatchTier, string> = {
  verified: "Verified",
  likely: "Likely",
  unmatched: "Unmatched",
};

export function TierBadge({
  level,
  id,
}: {
  level: DomainMatchLevel | string | null | undefined;
  id?: string;
}) {
  if (!level) {
    return null;
  }
  const tier = domainMatchTier(level);
  return (
    <span className={`f9-tier-badge is-${tier}`} id={id}>
      {TIER_LABEL[tier]}
    </span>
  );
}
