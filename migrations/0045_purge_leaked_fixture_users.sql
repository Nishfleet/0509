-- Removes the two test accounts made after 0044 ran (0509#6968): e2e+<12 hex> at 2026-10-04T18:13:00Z
-- and e2e+<16 hex> at 18:34:15Z. Neither came from a spec: a worker's live browser check on
-- production signed up fresh addresses and did not delete them. Same rows as the leftover count
-- in e2e-scheduled.yml soak-report, minus the eight fixed journey accounts. Real accounts are untouched.
-- apikey.referenceId has no foreign key, so its rows go first; every other table cascades from "user".
DELETE FROM apikey WHERE referenceId IN (
  SELECT id FROM "user"
  WHERE (email LIKE 'e2e+%@0509.io' OR email LIKE 'canary%' OR email LIKE '%@fixture.0509.in')
    AND email NOT IN ('e2e+j7@0509.io', 'e2e+j8-hard@0509.io', 'e2e+j8-soft@0509.io', 'e2e+j8-hard-v2@0509.io', 'e2e+j8-soft-v2@0509.io', 'e2e+j9-mentions@0509.io', 'e2e+j12-rollovers@0509.io', 'e2e+soak@0509.io')
);
DELETE FROM "user"
WHERE (email LIKE 'e2e+%@0509.io' OR email LIKE 'canary%' OR email LIKE '%@fixture.0509.in')
  AND email NOT IN ('e2e+j7@0509.io', 'e2e+j8-hard@0509.io', 'e2e+j8-soft@0509.io', 'e2e+j8-hard-v2@0509.io', 'e2e+j8-soft-v2@0509.io', 'e2e+j9-mentions@0509.io', 'e2e+j12-rollovers@0509.io', 'e2e+soak@0509.io');
