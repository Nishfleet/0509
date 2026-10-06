-- Existing keys minted before expiry and the advertised read scope were
-- turned on. Stamp both so verifyApiKey's read check and the 90-day default
-- apply to rows already in production, not only keys created after this PR.
UPDATE "apikey"
SET "permissions" = '{"read":["*"]}'
WHERE "permissions" IS NULL;

UPDATE "apikey"
SET "expiresAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90 days')
WHERE "expiresAt" IS NULL;
