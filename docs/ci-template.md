# CI template

Nishfleet/0509 is the template for the product repos' CI (fleet-ops#10935).
Copy these files, keep the job names, and change only the lines listed below.

| File                                      | What it does                                                    |
| ----------------------------------------- | --------------------------------------------------------------- |
| `.github/workflows/ci.yml`                | every check, GitHub-hosted, on `pull_request` and `merge_group` |
| `.github/workflows/deploy-production.yml` | deploys each merge to `main`, smokes, rolls back on a red smoke |
| `.github/dependabot.yml`                  | weekly, grouped: npm majors, npm minor and patch, Actions       |
| `.github/pull_request_template.md`        | the preview link and a three-step "try it" note for the owner   |

Jobs in `ci.yml`: `checks`, `test`, `e2e`, `secrets`, `semgrep`, `preview-build`,
`preview`, `ci-ok`. Each names the incident or rule behind it. A job with no
reason in your repo is deleted, not copied.

Repo settings: one ruleset on `main` with the merge queue, an empty bypass
list, and one required check, `ci-ok`. It needs every other job and accepts
only `success`, so never put a job-level `if:` on a job it needs.

Change per repo:

- `checks`, `test`, `e2e`: your own commands. Delete `test` if `checks` runs the suite in under 10 minutes, and `e2e` if there is no browser suite.
- `secrets`: copy `.github/gitleaks-private-detail.toml` too.
- `semgrep`: drop the two `.semgrep/rollover-catch-up` lines; that rule is 0509's own.
- `preview-build`, `preview`: your preview Worker name and build command. The preview Worker must export no Durable Object, or Cloudflare gives it no link (https://developers.cloudflare.com/workers/configuration/previews/). A Pages project uses `wrangler pages deploy --branch pr-<number>` instead.
- `deploy-production.yml`: your Worker, D1 database and health URL.
- `pull_request_template.md`: your preview URL pattern.
- Secrets and variables: `CLOUDFLARE_API_TOKEN` (repo) and `WORKERS_SUBDOMAIN` (variable) for `preview`; `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the `production` environment, `main` only.

`preview-build` runs the PR's code with no secret. `preview` holds the token
and runs no PR code. Dependabot, fork and merge-queue runs pass `preview`
without an upload, because they get no secrets.
