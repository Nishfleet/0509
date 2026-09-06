import { describe, expect, it } from "vitest";

import { SNEAKER_RESALE_MARKETS } from "~/lib/locale-markets";
import { sneakerResaleCopy } from "~/lib/sneaker-resale-copy";

// Prevention mechanism for issue #1542: the swing-mover section promises the
// copy "cannot read as evergreen while the market moves underneath it". This
// canary holds every locale's swingSource to the daily market signal it cites
// and fails when that as-of stamp is older than 14 days. When the section is
// allowed to go stale again, main goes red and the existing FleetMainRed
// reaction surfaces it.
const FRESHNESS_DAYS = 14;

describe("sneaker-resale swing-mover freshness", () => {
  it.each(SNEAKER_RESALE_MARKETS.map((market) => market.id))(
    "locale %s cites a swing market signal within 14 days of today",
    (id) => {
      const copy = sneakerResaleCopy(id);

      expect(copy.swingAsOfIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(copy.swingSource).toContain("2026-09-01");

      const asOf = new Date(`${copy.swingAsOfIso}T00:00:00Z`).getTime();
      expect(Number.isNaN(asOf)).toBe(false);

      const days = (Date.now() - asOf) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThanOrEqual(FRESHNESS_DAYS);
    },
  );
});
