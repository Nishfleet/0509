-- Keys minted before the read scope was advertised carry no read permission.
-- Add it to every key that lacks it so verifyApiKey's scope gate never rejects
-- a legacy key on deploy day. Other scopes on the key are kept; invalid or
-- NULL permissions are treated as an empty object.
UPDATE "apikey"
SET "permissions" = json_set(
  CASE WHEN json_valid("permissions") AND json_type("permissions") = 'object' THEN "permissions" ELSE '{}' END,
  '$.read',
  json('["*"]')
)
WHERE NOT (
  json_valid("permissions")
  AND json_type("permissions") = 'object'
  AND json_type("permissions", '$.read') = 'array'
  AND EXISTS (SELECT 1 FROM json_each("permissions", '$.read') WHERE "value" = '*')
);
