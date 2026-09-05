# 0509 Netcup renderer — operations runbook (credential-free)

Control-plane runbook for the bounded browser-rendering foundation. No secrets
live in this file or anywhere in the repo; secrets stay in
`~/.config/0509-renderer/` on the VPS.

## What this is

A loopback-only HTTP service on the Netcup VPS that runs exactly three job
kinds (`meta_discovery`, `landing_snapshot`, `report_pdf`) against the
Camofox engine (port 9377) and chrome-headless-shell, with an HMAC request
authentication contract the later 0509 adapter implements. It is the
foundation for a future 0509 pull/relay — no public ingress exists in this
packet, port 9377 is never exposed, and no 0509 traffic is routed to it yet.

Full contract: `ops/netcup-browser/CONTRACT.md` in the 0509 repo.

## Layout

- Source: `ops/netcup-browser/src/` (repo) -> installed copy in
  `~/.local/share/0509-renderer/src/` (VPS)
- Unit: `ops/netcup-browser/deploy/0509-renderer.service` (template, has
  `__INSTALL_DIR__` substituted by `install.sh`)
- Config: `~/.config/0509-renderer/public.env` (port/bind/origin),
  `~/.config/0509-renderer/secrets.env` (optional Camofox access key),
  `~/.config/0509-renderer/hmac-secret` (+ `hmac-secret.prev` during rotation)
- State: `~/.local/share/0509-renderer/artifacts/`, `.../tmp/`

## Install / upgrade

```sh
ops/netcup-browser/deploy/install.sh          # idempotent; backups anything overwritten
systemctl --user start 0509-renderer.service
ops/netcup-browser/deploy/verify.sh           # healthz + readyz + loopback-only + secret checks
```

## Health checks

- `GET http://127.0.0.1:9382/healthz` — cheap liveness (no dependencies).
- `GET http://127.0.0.1:9382/readyz` — real readiness: Camofox `/health`,
  chrome-headless-shell binary present, credentials loaded, dirs writable,
  queue stats. 200 only when all green.

## Enqueue a job (adapter-facing contract)

Signature: HMAC-SHA256 over the canonical string in CONTRACT.md; send

```
POST /jobs
Authorization: 0509-HMAC <tenant>:<unixSeconds>:<nonce>:<hexSignature>
{"kind":"landing_snapshot","tenant":"t","workspace":"w","jobId":"j1",
 "idempotencyKey":"j1","params":{"url":"https://example.com"},"deadlineMs":...}
```

then poll `GET /jobs/j1?tenant=t&workspace=w` and fetch
`GET /artifacts/j1/landing.html` (sha256 in `x-artifact-sha256`).

## HMAC secret rotation (documented contract)

1. `umask 077; node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex")+"\n")' > ~/.config/0509-renderer/hmac-secret.new`
2. `mv ~/.config/0509-renderer/hmac-secret ~/.config/0509-renderer/hmac-secret.prev`
3. `mv ~/.config/0509-renderer/hmac-secret.new ~/.config/0509-renderer/hmac-secret`
4. `systemctl --user restart 0509-renderer.service` — the verifier loads both
   keys, so in-flight requests signed with the previous key still pass during
   the overlap window. Remove `hmac-secret.prev` once all adapters have rotated.

## Camoufox health-probe repair (this packet's control-plane fix)

The installed Camofox server (`~/.local/share/camofox-browser/1.13.1/.../server.js`)
restarted its browser every ~3 minutes because its internal health probe called
`browser.newContext()` without `viewport: null`, making Playwright send
`Browser.setDefaultViewport` with `isMobile`, which the Camoufox Juggler
protocol scheme does not describe. The probe now calls
`browser.newContext({ viewport: null })` (matching every real session context).

- Timestamped byte-identical backup: `server.js.bak-*` in the same directory.
- Regression proof: `ops/netcup-browser/tests/camoufox-viewport-regression.test.mjs`
  (red against the pre-fix source, green after).
- Undo: `cp -p <backup> server.js && systemctl --user restart camofox-browser.service`
  (see the harness-ledger entry for the exact backup name).

## Rollback of the renderer service

```sh
ops/netcup-browser/deploy/rollback.sh    # restores newest source .bak-*, restarts unit
```

## Notes

- Initial concurrency is 1 with a bounded queue (4) — deliberate.
- Artifacts are capped (HTML 1 MiB, JPEG 3 MiB, PDF 10 MiB) with SHA-256.
- No D1 access and no customer Meta token ever reach the VPS from 0509.
