-- Removes every account except the four fixed accounts the production specs sign in with (#5730).
-- Nish 2026-09-28 14:04:55Z "wipe", 16:35:09Z "yes, delete the leftover test accounts in production",
-- 16:35:39Z "no real users bruv, okay to wipe everything".
-- Kept: e2e+j7, e2e+j8-soft, e2e+j9-mentions, e2e+j12-rollovers @0509.io.
-- apikey.referenceId has no foreign key, so its rows go first; every other table cascades from "user".
DELETE FROM apikey WHERE referenceId IN (
  SELECT id FROM "user"
  WHERE email NOT IN ('e2e+j7@0509.io', 'e2e+j8-soft@0509.io', 'e2e+j9-mentions@0509.io', 'e2e+j12-rollovers@0509.io')
);
DELETE FROM "user"
WHERE email NOT IN ('e2e+j7@0509.io', 'e2e+j8-soft@0509.io', 'e2e+j9-mentions@0509.io', 'e2e+j12-rollovers@0509.io');
