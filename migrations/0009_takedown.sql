-- The takedown list (docs/REBUILD-GUARDRAILS.md § Takedown).
--
-- One row per subject that asked to be removed. `subject` holds the same value
-- entity.domain and suggestion.candidate_domain hold, so every check is an
-- equality lookup on this primary key.
--
-- The row is the permanent record: it is never deleted, because a future
-- workspace adding the same subject is refused by it.
CREATE TABLE takedown (
  subject TEXT PRIMARY KEY NOT NULL,
  requested_at TEXT NOT NULL,
  actioned_at TEXT NOT NULL,
  actioned_by TEXT NOT NULL,
  note TEXT
);

-- Recording a takedown is one INSERT. The database does the rest in the same
-- transaction, in every workspace at once: each owner who tracked the subject
-- gets the one-line note, the competitor is dismissed with reason 'takedown'
-- (the state every surface already honours, and what the public card's serve
-- path reads), and any pending suggestion of it is dismissed. There is no
-- fan-out job to fail halfway and nothing to reconcile.
--
-- A workspace's own brand (role 'self') is left alone: it is that customer's
-- identity, not someone tracking the subject.
CREATE TRIGGER takedown_fan_out AFTER INSERT ON takedown
BEGIN
  INSERT INTO alert (id, workspace_id, entity_id, kind, title, created_at)
  SELECT 'takedown-' || e.id, e.workspace_id, e.id, 'takedown',
         COALESCE(NULLIF(e.name, ''), e.domain) || ' asked to be removed from tracking, so we stopped tracking it.',
         NEW.actioned_at
  FROM entity e
  WHERE e.domain = NEW.subject AND e.role = 'competitor' AND e.state <> 'dismissed';

  UPDATE entity
  SET state = 'dismissed', state_reason = 'takedown', state_changed_by = 'auto', state_changed_at = NEW.actioned_at
  WHERE domain = NEW.subject AND role = 'competitor';

  UPDATE suggestion
  SET status = 'dismissed', decided_by = 'takedown', decided_at = NEW.actioned_at
  WHERE candidate_domain = NEW.subject AND status = 'pending';
END;

-- After the takedown, the subject cannot come back through any path: not as a
-- new brand in any workspace, not as a suggestion from discovery, and not by
-- flipping a dismissed row back on. RAISE(IGNORE) skips the row and nothing
-- else, so a batch that happens to include the subject still commits the rest.
CREATE TRIGGER takedown_blocks_entity BEFORE INSERT ON entity
WHEN EXISTS (SELECT 1 FROM takedown WHERE subject = NEW.domain)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER takedown_blocks_revival BEFORE UPDATE OF state ON entity
WHEN NEW.state <> 'dismissed' AND EXISTS (SELECT 1 FROM takedown WHERE subject = NEW.domain)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER takedown_blocks_suggestion BEFORE INSERT ON suggestion
WHEN EXISTS (SELECT 1 FROM takedown WHERE subject = NEW.candidate_domain)
BEGIN
  SELECT RAISE(IGNORE);
END;
