-- A create-key form carries one submission id into the key's metadata; this index makes a repeated or aborted submit insert one row (0509#6588).
CREATE UNIQUE INDEX "apikey_submission_unique" ON "apikey" ("referenceId", json_extract("metadata", '$.submission')) WHERE json_extract("metadata", '$.submission') IS NOT NULL;
