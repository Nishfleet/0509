ALTER TABLE stytch_auth_request
  ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'magic_link' CHECK (auth_method IN ('magic_link', 'oauth'));
