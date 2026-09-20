-- Better Auth organization plugin swap (issue #3787, phase 1 of the
-- expand/contract): create the plugin's organization/member/invitation tables,
-- add session.activeOrganizationId, and backfill from `org`/`workspace_member`.
-- The legacy tables stay for rollback; they are dropped in a follow-up phase.
--
-- Storage conventions match the installed better-auth 1.7.1 D1 adapter
-- (supportsDates=false): `date` fields are TEXT carrying toISOString() output,
-- model/field names map 1:1 to camelCase column names. `invitation.expiresAt`
-- stays nullable although the plugin marks it required — legacy invited rows
-- may carry NULL token_expires_at, which the service layer treats as
-- never-expiring; plugin-created invitations always set it. `tokenHash` is the
-- plugin additionalField wired in better-auth.server.ts (emailed links carry
-- the raw token; at rest only sha256(token) is stored).

CREATE TABLE IF NOT EXISTS organization (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo TEXT,
  createdAt TEXT NOT NULL,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS member (
  id TEXT PRIMARY KEY NOT NULL,
  organizationId TEXT NOT NULL,
  userId TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  createdAt TEXT NOT NULL,
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invitation (
  id TEXT PRIMARY KEY NOT NULL,
  organizationId TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expiresAt TEXT,
  createdAt TEXT NOT NULL,
  inviterId TEXT NOT NULL,
  tokenHash TEXT,
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE,
  FOREIGN KEY (inviterId) REFERENCES user(id) ON DELETE CASCADE
);

ALTER TABLE session ADD COLUMN activeOrganizationId TEXT;

CREATE INDEX IF NOT EXISTS idx_member_organization ON member(organizationId);
CREATE INDEX IF NOT EXISTS idx_member_user ON member(userId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_org_user ON member(organizationId, userId);
-- One live teammate seat per user — the 0067 invariant carried over.
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_teammate_seat
  ON member(userId) WHERE role = 'member';
CREATE INDEX IF NOT EXISTS idx_invitation_organization ON invitation(organizationId);
CREATE INDEX IF NOT EXISTS idx_invitation_email ON invitation(email);
CREATE INDEX IF NOT EXISTS idx_invitation_token_hash ON invitation(tokenHash);
-- One pending invite per (org, email) — mirrors idx_workspace_member_owner_email.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitation_org_pending_email
  ON invitation(organizationId, email) WHERE status = 'pending';

-- Personal orgs: one per user, keeping the 'org_<userId>' identity 0089 minted
-- so the dormant org_id columns stay valid. slug mirrors the same derivation;
-- metadata.ownerUserId mirrors the owner member row for readability.
INSERT OR IGNORE INTO organization (id, name, slug, logo, createdAt, metadata)
SELECT 'org_' || u.id,
       u.name,
       'org-' || u.id,
       NULL,
       u.createdAt,
       json_object('ownerUserId', u.id)
  FROM user u;

-- Every user holds role='owner' on their personal org.
INSERT OR IGNORE INTO member (id, organizationId, userId, role, createdAt)
SELECT 'mem_' || u.id, 'org_' || u.id, u.id, 'owner', u.createdAt
  FROM user u;

-- Teammate seats: active workspace_member rows become role='member' rows on the
-- owner's org, keeping the workspace_member id so memberRowId stays stable.
INSERT OR IGNORE INTO member (id, organizationId, userId, role, createdAt)
SELECT wm.id,
       'org_' || wm.owner_user_id,
       wm.member_user_id,
       'member',
       COALESCE(wm.accepted_at, wm.created_at)
  FROM workspace_member wm
 WHERE wm.status = 'active' AND wm.member_user_id IS NOT NULL;

-- Every workspace_member row leaves an invitation row (the plugin's tombstone
-- model): invited -> pending (tokenHash carried so in-flight links keep
-- working), active -> accepted, revoked -> canceled.
INSERT OR IGNORE INTO invitation
  (id, organizationId, email, role, status, expiresAt, createdAt, inviterId, tokenHash)
SELECT wm.id,
       'org_' || wm.owner_user_id,
       wm.invited_email,
       'member',
       CASE wm.status
         WHEN 'invited' THEN 'pending'
         WHEN 'active' THEN 'accepted'
         WHEN 'revoked' THEN 'canceled'
         ELSE 'canceled'
       END,
       wm.token_expires_at,
       wm.created_at,
       wm.owner_user_id,
       CASE WHEN wm.status = 'invited' THEN wm.token_hash END
  FROM workspace_member wm;
