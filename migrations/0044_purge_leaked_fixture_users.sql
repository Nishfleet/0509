-- Removes the test accounts the e2e runs leaked after the 0026 purge (0509#6968): 42 rows on
-- 2026-10-04T16:46Z, from magic-link-expiry signing its own page out before the afterEach,
-- onboarded setups cut short, and the throwaway proof-clef dispatches. Same rows as the
-- leftover count in e2e-scheduled.yml soak-report: test addresses only, minus the eight fixed
-- journey accounts the scheduled specs keep on purpose. Real accounts are untouched.
-- apikey.referenceId has no foreign key, so its rows go first; every other table cascades from "user".
DELETE FROM apikey WHERE referenceId IN (
  SELECT id FROM "user"
  WHERE (email LIKE 'e2e+%@0509.io' OR email LIKE 'canary%' OR email LIKE '%@fixture.0509.in')
    AND email NOT IN ('e2e+j7@0509.io', 'e2e+j8-hard@0509.io', 'e2e+j8-soft@0509.io', 'e2e+j8-hard-v2@0509.io', 'e2e+j8-soft-v2@0509.io', 'e2e+j9-mentions@0509.io', 'e2e+j12-rollovers@0509.io', 'e2e+soak@0509.io')
);
DELETE FROM "user"
WHERE (email LIKE 'e2e+%@0509.io' OR email LIKE 'canary%' OR email LIKE '%@fixture.0509.in')
  AND email NOT IN ('e2e+j7@0509.io', 'e2e+j8-hard@0509.io', 'e2e+j8-soft@0509.io', 'e2e+j8-hard-v2@0509.io', 'e2e+j8-soft-v2@0509.io', 'e2e+j9-mentions@0509.io', 'e2e+j12-rollovers@0509.io', 'e2e+soak@0509.io');
