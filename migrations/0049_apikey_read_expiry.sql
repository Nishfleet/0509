-- Keys minted before the read scope was advertised carry no read permission.
-- Stamp it on every key that lacks it so verifyApiKey's scope gate never
-- rejects a legacy key on deploy day. expiresAt stays NULL (no expiry) on
-- existing keys; only keys minted from now on get the 90-day default.
UPDATE "apikey"
SET "permissions" = '{"read":["*"]}'
WHERE "permissions" IS NULL OR "permissions" NOT LIKE '%"read":["*"]%';
