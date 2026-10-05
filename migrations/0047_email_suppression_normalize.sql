-- Stores every email_suppression address trimmed and lowercased (0509#7128), so the lookup in
-- app/lib/data/email_suppression.server.ts can match the primary key exactly instead of scanning
-- the table through lower(trim(address)).
-- Rows that differ only by case or surrounding spaces collapse to one suppression: the earliest
-- created_at wins, with its reason. No address loses its suppression.
INSERT INTO email_suppression (address, reason, created_at)
SELECT lower(trim(e.address)), e.reason, e.created_at
  FROM email_suppression e
 WHERE e.address <> lower(trim(e.address))
   AND e.created_at = (
     SELECT min(x.created_at) FROM email_suppression x WHERE lower(trim(x.address)) = lower(trim(e.address))
   )
ON CONFLICT(address) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at
 WHERE excluded.created_at < email_suppression.created_at;
DELETE FROM email_suppression WHERE address <> lower(trim(address));
