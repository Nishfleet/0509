# Google Search Console site verification plumbing

The homepage head renders a `<meta name="google-site-verification" content="...">` tag **only** when the `GOOGLE_SITE_VERIFICATION` environment variable is set on the Worker (`app/root.tsx` root loader -> root `meta()`). Unset, no tag is emitted and nothing changes.

Where the value comes from:

1. The site owner (Nish) creates the property in Google Search Console for `https://0509.io/` and copies the `google-site-verification` meta-tag content value. This is an owner-account step and is not automated.
2. Set it as a Worker secret: `npx wrangler secret put GOOGLE_SITE_VERIFICATION` (production) or add it to `.dev.vars` locally.
3. Deploy, then verify with `curl -sS https://0509.io/ | grep google-site-verification`.

No verification value is committed to the repo. Rollback: remove the secret or revert the PR — the tag renders only when the variable exists.

This plumbing unblocks the BET 5 Search Console gates (indexed pages, non-branded impressions).
