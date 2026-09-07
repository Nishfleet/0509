# 0509 Netcup renderer — service contract

Narrow, private, bounded browser-rendering foundation for 0509, running on the
Netcup VPS. This document is the implementable contract for the later 0509
pull/relay or authenticated ingress adapter. Nothing here is public ingress;
the service binds loopback only.

## Job kinds (only these three exist)

| Kind              | Engine                          | Output                                    |
| ----------------- | ------------------------------- | ----------------------------------------- |
| `meta_discovery`  | Camofox HTTP API (port 9377)    | ariaSnapshot JSON + JPEG screenshot        |
| `landing_snapshot`| chrome-headless-shell            | rendered HTML (1 MiB) + JPEG (3 MiB)       |
| `report_pdf`      | chrome-headless-shell            | PDF of the worker-signed 0509 share URL (10 MiB) |

Any other kind is rejected at the API with `invalid_job_kind`. There is no
general-purpose browser endpoint, no raw CDP, no arbitrary evaluate, and no
cookie/token exposure.

## Concurrency and deadlines

- Concurrency is pinned to `1` (foundation). One atomic absolute deadline per
  job (`deadlineMs`), capped at the per-kind budget; jobs past their deadline
  fail with `deadline_exceeded` and the engine is torn down.
- Bounded FIFO queue (`maxQueued`, default 4). Full queue -> HTTP 429
  `queue full — retry later`.
- Idempotency key: re-submitting the same `idempotencyKey` inside the retention
  window returns the cached result envelope without re-execution.

## URL policy (per kind, enforced at enqueue AND at execution)

- `meta_discovery`: allowlisted Meta Ad Library host (`www.facebook.com`,
  `facebook.com`), https only, path under `/ads/library/`, allowlisted query
  params with per-param value rules. Anything else is rejected.
- `landing_snapshot`: http/https only, no URL credentials, port 80/443 only,
  no loopback/private/link-local/metadata IPv4 or IPv6 (literal or resolved).
  Every redirect hop is re-resolved and re-checked; at most 5 redirects.
- `report_pdf`: only a worker-signed same-origin 0509 share URL shape built
  from a validated 32-hex-char share token against the configured
  `RENDERER_PDF_ORIGIN`. A client-supplied URL is never accepted for PDF.

## Output bounds (match 0509 limits)

| Artifact      | Cap     | Content type            |
| ------------- | ------- | ----------------------- |
| landing HTML  | 1 MiB   | `text/html`             |
| JPEGs         | 3 MiB   | `image/jpeg`            |
| PDF           | 10 MiB  | `application/pdf`       |

Every artifact is returned with its SHA-256 (`x-artifact-sha256`) and byte
count. The VPS receives no D1 access and no customer Meta token.

## Request authentication (HMAC-SHA256)

```
Authorization: 0509-HMAC <tenant>:<unixSeconds>:<nonce>:<hexSignature>

canonical = "0509-hmac-v1\n" + tenant + "\n" + workspace + "\n" + jobId
          + "\n" + METHOD + "\n" + path + "\n" + bodyHash
          + "\n" + timestamp + "\n" + nonce
bodyHash  = lowercase hex sha256 of the raw request body (empty -> sha256(""))
signature = lowercase hex HMAC-SHA256(secret, canonical)
```

- The signature binds tenant/workspace, job id, method/path, body hash,
  timestamp, and nonce.
- Timestamp tolerance: ±300 s. Nonces are single-use and rejected atomically
  (replay cache, 10 min TTL, max 4096 entries).
- Secrets live only in the credential directory (`~/.config/0509-renderer/`):
  `hmac-secret` (active) and `hmac-secret.prev` (previous, accepted during
  rotation overlap). Rotation: write new key to a temp file, rename over
  `hmac-secret`, move the old active to `hmac-secret.prev`, reload the service.
- Never put secrets in the repo, report, or logs.

## HTTP surface (loopback only, `127.0.0.1`)

| Route                  | Auth | Meaning                                        |
| ---------------------- | ---- | ---------------------------------------------- |
| `GET /healthz`         | no   | cheap liveness (no dependencies)               |
| `GET /readyz`          | no   | real readiness (Camofox health, chrome, creds, dirs) |
| `POST /jobs`           | HMAC | enqueue a job (validates policy BEFORE queue)  |
| `GET /jobs/:jobId`     | HMAC | result envelope (status, evidence, timings)    |
| `GET /artifacts/:jobId/:name` | HMAC | bounded artifact bytes + sha256 header  |

Logs never include bodies, cookies, tokens, or the Authorization header.

## Isolation and cleanup

Every job gets a fresh context/profile: Camofox jobs create a dedicated tab
(`userId`/`sessionKey` derived from the job id) and delete it in `finally`;
chrome jobs use a fresh `--user-data-dir` under the service tmp root, removed
in `finally`, including on timeout/crash/abort. Downloads, popups, and external
protocols are not enabled anywhere in the engine invocation.
