-- 0015_discovery_backlog.sql — the candidates the discovery shortlist did not take.
--
-- docs/engines/competitor-discovery.md graft 2: "unjudged is a queue, not a
-- graveyard". A brand that a source named, but that did not clear the shortlist,
-- keeps its evidence here until a second source pushes it over the bar. Rows are
-- keyed by the normalised name and are never deleted; promoted_at records the run
-- whose counts put a candidate on the shortlist.
--
-- Additive only: one CREATE TABLE.
CREATE TABLE discovery_backlog (
  workspace_id TEXT NOT NULL,
  name_key TEXT NOT NULL,
  name TEXT NOT NULL,
  domain TEXT,
  evidence_json TEXT NOT NULL,
  evidence_count INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  promoted_at TEXT,
  PRIMARY KEY (workspace_id, name_key),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);
