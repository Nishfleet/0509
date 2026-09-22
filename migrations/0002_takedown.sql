-- 0002_takedown.sql — the takedown list (docs/REBUILD-GUARDRAILS.md): a subject
-- on it is refused at onboarding and dropped at the next tick. Expand-only:
-- new table, no changes to existing tables, safe to roll back code over it.
-- Recorded by hand (Nish or the deputy) when a removal request lands.

CREATE TABLE takedown (
  id TEXT PRIMARY KEY NOT NULL,
  -- The refused subject: a registrable domain ('gymshark.com') or a
  -- platform-qualified handle ('instagram:gymshark').
  subject TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL DEFAULT 'remove',
  note TEXT,
  created_at TEXT NOT NULL
);
