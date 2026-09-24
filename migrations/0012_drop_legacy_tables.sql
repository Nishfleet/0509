-- 0012_drop_legacy_tables.sql — drop the eight pre-rebuild tables no migration creates.
--
-- docs/REBUILD-DONE.md lists them as production drift: the old app's Stytch
-- sign-in, passkey, Dodo checkout, paid-work and website-watch tables. No code
-- reads or writes them, and nothing references them. On 2026-09-24 they held
-- 3 rows between them. Nish approved the drop without a backup on 2026-09-24
-- (the old app had no users). IF EXISTS because local and test D1 never had them.
DROP TABLE IF EXISTS website_watch_target;
DROP TABLE IF EXISTS paid_work_queue;
DROP TABLE IF EXISTS dodo_checkout_attempt;
DROP TABLE IF EXISTS passkey_challenge;
DROP TABLE IF EXISTS passkey_credential;
DROP TABLE IF EXISTS stytch_session;
DROP TABLE IF EXISTS stytch_identity;
DROP TABLE IF EXISTS stytch_auth_request;
