import { describe, expect, it } from "vitest";

import {
  classifySeedListVerdict,
  resolveSeedList,
  SEED_LISTS,
  validateSeedList,
} from "~/lib/ads-domain-publisher.server";

/**
 * Issue #1547 termination guard. The issue closes only when the sneaker-resale
 * cluster's five termination domains — nike.com, stockx.com, goat.com,
 * saucony.com, hoka.com — are seeded for the /ads/:domain publisher, each
 * carries a brand label (accept 1), and the publish floor still refuses to
 * ship a page with zero verified/likely ads (accept 6). The existing
 * ads-domain-publisher suite asserts the list validates and holds ≥15 entries;
 * it does NOT pin the specific termination domains, so silently dropping
 * saucony.com or hoka.com would break the issue's termination command while
 * every other test stayed green. This canary closes that hole.
 */
const TERMINATION_DOMAINS = [
  { domain: "nike.com", brand: "Nike" },
  { domain: "stockx.com", brand: "StockX" },
  { domain: "goat.com", brand: "GOAT" },
  { domain: "saucony.com", brand: "Saucony" },
  { domain: "hoka.com", brand: "Hoka" },
] as const;

describe("sneaker-resale cluster termination (issue #1547)", () => {
  const list = SEED_LISTS["sneaker-resale"];

  it("the sneaker-resale seed list is registered and validates clean", () => {
    expect(list).toBeDefined();
    expect(validateSeedList(list)).toEqual([]);
  });

  it.each(TERMINATION_DOMAINS)(
    "seed list carries $domain with a $brand label (accept 1)",
    ({ domain, brand }) => {
      expect(resolveSeedList("sneaker-resale")).not.toBeNull();
      const entry = list.domains.find(
        (d) => d.domain.toLowerCase() === domain.toLowerCase(),
      );
      expect(entry, `termination domain ${domain} missing from seed list`).toBeDefined();
      expect(entry?.brand, `${domain} must carry a brand label`).toBe(brand);
    },
  );

  it("the publish floor refuses to ship a page with zero verified/likely ads (accept 6)", () => {
    expect(classifySeedListVerdict(0, 0)).toBe("skip");
    expect(classifySeedListVerdict(1, 0)).toBe("publish");
    expect(classifySeedListVerdict(0, 1)).toBe("publish");
  });
});
