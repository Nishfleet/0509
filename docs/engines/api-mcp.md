# Engine 8 — API and MCP

P3 step 8 of umbrella #3842, engine child **#3905**. Written by the Opus deputy (second architect), **2026-09-21**. Contracts: the charter's agent-native addendum (Nish, 2026-09-21 ~18:05 IST), `docs/REBUILD-STACK.md` §7, `docs/REBUILD-SCHEMA.md`, `docs/REBUILD-DONE.md`.

The charter, verbatim: *"everything a human sees on Home, Competitors and Alerts is available to an agent through a read API and an MCP server, on every paid plan (no free plan exists). Settings carries 'Connect your agent' (API key, MCP URL). Stock only … No hand-rolled auth or rate limiting."*

---

## 0. Live probes

The upstreams here are packages, so the probe is the published artifact. All read **2026-09-21 12:16–12:20 UTC** from `registry.npmjs.org`.

| Package | `dist-tags.latest` | Published |
|---|---|---|
| `agents` | **0.24.0** | 2026-09-18 |
| `@modelcontextprotocol/server` | **2.0.0** | 2026-07-27 |
| `@modelcontextprotocol/client` | **2.0.0** | 2026-07-27 |
| `@better-auth/api-key` | **1.7.5** | 2026-09-14 |
| `@cloudflare/workers-oauth-provider` | **0.10.3** | 2026-08-10 |
| `zod-openapi` | **6.0.2** | 2026-08-31 |
| `zod` | **4.6.5** | 2026-09-13 |
| `wrangler` | **4.135.0** | 2026-09-18 |

**I unpacked `agents@0.24.0` and read its manifest and types**, because the stack doc's central claim for this engine — that the stateless handler is the one to use — is the thing most likely to be built wrong from memory.

Exports map, verbatim from `package/package.json`:

```
./mcp         -> dist/mcp/index.js
./mcp/server  -> dist/mcp/server/index.js
./mcp/client  -> dist/mcp/client/index.js
```

And `dist/mcp/server/index.d.ts` line 15:

```ts
createStatelessMcpHandler as createMcpHandler,
```

**So `createMcpHandler` imported from `agents/mcp/server` *is* the stateless handler, under an alias.** The same identifier exported from `agents/mcp` is the legacy overload. The stack doc's warning that "the import path is load-bearing" is confirmed at the source: the two paths give you two different functions with the same name, and only one of them avoids a Durable Object.

`peerDependencies`, verbatim, with `peerDependenciesMeta` showing which are optional:

```
"@modelcontextprotocol/client": "2.0.0"     not optional
"@modelcontextprotocol/sdk":    "1.30.0"    not optional
"@modelcontextprotocol/server": "2.0.0"     not optional
"zod":                          "^4.0.0"    not optional
```

Optional (and therefore not ours): `@ai-sdk/react`, `@cloudflare/codemode`, `@tanstack/ai`, `@x402/core`, `@x402/evm`, `ai`, `chat`, `just-bash`, `react`, `vite`.

**Three MCP packages are exact-pinned and non-optional**, including the legacy `@modelcontextprotocol/sdk@1.30.0`, even for a stateless-only server. `package.json` will list all three; a reviewer seeing `sdk@1.30.0` and calling it a mistake would be wrong, and this paragraph exists so that review does not happen twice.

Also probed, for §5: `npx wrangler@4.135.0 r2 bucket lifecycle --help` — relevant to engine 10, confirmed present in this wrangler.

---

## 1. Design it twice — how an agent authenticates

Everything else in this engine is settled by the stack doc. This is the fork, and it is sharper than it looks because of an architectural collision neither contract mentions.

**The collision.** `@cloudflare/workers-oauth-provider` is used as the Worker's **default export**:

```ts
export default new OAuthProvider({ apiRoute: "/mcp", apiHandler: …, defaultHandler: … });
```

But `workers/app.ts` in a React Router 8 framework-mode app is *already* the default export — `export default { async fetch(request) { return requestHandler(request); } }` (`docs/REBUILD-STACK.md` §1.3, verbatim from the scaffold). There is one default export per Worker. So adopting the OAuth provider means the React Router handler stops being the Worker's entry point and becomes the provider's `defaultHandler`, and **every request to every page of the app is routed through the OAuth library first**.

### Candidate A — OAuth 2.1, spec-conformant

`@cloudflare/workers-oauth-provider` **0.10.3** wraps the Worker. One KV binding (`OAUTH_KV`), an `/authorize` endpoint, a consent screen, `clientIdMetadataDocumentEnabled` (which additionally needs the `global_fetch_strictly_public` compatibility flag).

- **It is what the spec requires.** MCP revision 2026-07-28: *"MCP servers **MUST** implement OAuth 2.0 Protected Resource Metadata (RFC9728)"* and *"Authorization servers MUST implement OAuth 2.1."*
- Interactive MCP clients that do the discovery dance — the connector flows in desktop LLM clients — work by pasting a URL and clicking through. No key handling by the user.
- Tokens are audience-checked and `props` are AES-GCM encrypted at rest.
- **It puts an auth library on the request path of every page load** in an app whose budget is LCP under 1.5 s and no Home loader request over 500 ms at p95 (`docs/REBUILD-DONE.md` §B). The cost is probably small; the blast radius is not — a bug or a bad deploy in the OAuth layer takes down the marketing site, not just `/mcp`.
- It adds a KV namespace, a consent UI, and a second identity system beside better-auth, which already owns sessions, magic links and passkeys. Two things that know who you are.
- The provider explicitly does **not** do multi-tenancy: *"Application permissions — scope, ownership, tenancy — remain ours to enforce."* So workspace scoping is ours either way.

### Candidate B — API keys, via better-auth's plugin

`@better-auth/api-key` **1.7.5**. `/mcp` is an ordinary React Router resource route; the MCP handler is composed inside it; the bearer token is an API key the user generates in Settings.

- **It is what the charter specifies**: *"Settings carries 'Connect your agent' (API key, MCP URL)."*
- **Nothing wraps the app.** `workers/app.ts` stays the scaffold's eleven lines, and a fault in the API surface cannot reach the marketing site.
- The plugin generates **one table, `apikey`, with 22 columns**, and those columns are the product: `rateLimitEnabled`, `rateLimitTimeWindow`, `rateLimitMax`, `requestCount`, `remaining`, `refillInterval`, `refillAmount`, `lastRefillAt`, `expiresAt`, `permissions`, `metadata`. **Per-key quota, refill, expiry and permissions ship in the box** — and per §3 that is the only thing that can meter a paid plan correctly.
- One identity system: the plugin supports sessions-from-API-keys, so the browser and the agent resolve to the same user through the same code.
- **It does not satisfy the spec's MUST.** An interactive client expecting RFC 9728 discovery will not auto-configure; the user configures a header. That is a real product limitation and naming it is the price of choosing this.

### Screening, and the decision

**Decision: API keys (bearer) for v1, on both the REST API and the MCP server.** One credential, one code path, one quota. Candidate A is recorded with its revisit trigger, not deferred vaguely.

Three reasons, in order of weight:

1. **The quota argument is decisive and it is not about convenience.** `docs/REBUILD-STACK.md` §7.4 is explicit that Cloudflare's rate-limit binding is *"permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system"* and is **per-colo, not global** — so using it to enforce a customer's plan limit *"would under-count across colos"*, a billing bug by construction. The only exact, per-key, persisted counter available without hand-rolling one is `apikey.requestCount`/`remaining`. Candidate A does not provide it; adopting A still means adopting the `apikey` table for metering, which means adopting both.
2. **Blast radius.** Candidate A moves every page load of the product behind an auth library to serve one endpoint. That is a disproportionate coupling for a v1 whose landing page has a 1.5 s LCP budget.
3. **The charter names API keys.** It is not ambiguous, and `docs/REBUILD-STACK.md` §7.3 independently reached the same conclusion.

**The conformance gap, stated plainly so nobody discovers it in a support thread:** our MCP server is non-conformant with the 2026-07-28 revision's authorization section, which makes OAuth 2.1 and RFC 9728 a MUST. Clients that require RFC 9728 discovery will not connect by URL alone; they need a configured `Authorization: Bearer <key>` header. Two obligations follow, and both are packet requirements rather than notes: Settings' "Connect your agent" panel shows **the header alongside the URL**, and the API docs say the server uses bearer tokens rather than OAuth, so an integrator finds out from us before they find out from a failed connection.

**Grafted from A, because A was right that discovery matters:**

1. **`/.well-known/oauth-protected-resource` is implemented when A lands, and not before.** Serving the metadata document while no authorization server exists would advertise a flow that does not work — worse than not serving it.
2. **`llms.txt` and the OpenAPI document are the discovery surface we *can* honestly ship now** (§4). An agent that can read finds the API without any handshake.

**The revisit trigger, stated precisely: the first client that refuses a bearer token.** Not "when we have time", not "when a customer asks about OAuth" — a client that will accept an `Authorization: Bearer` header, however configured, is served by v1 and is not a trigger. At that point Candidate A is additive — `apiRoute: "/mcp"`, `apiHandler` the existing handler, `defaultHandler` the existing React Router export — and the `apikey` table stays for metering regardless. Nothing in this design has to be undone.

**Rejected outright, recorded:** `McpAgent` from `agents/mcp` — deprecated and feature-frozen by Cloudflare's own docs, and it forces a Durable Object plus a migration for session state we do not want. The C3 MCP templates (`remote-mcp-authless`, `remote-mcp-github-oauth`) — the same docs page says not to start from them because they use the deprecated path. `@modelcontextprotocol/sdk` **as the server** — it hard-depends on `express`, `cors`, `raw-body` and `@hono/node-server`; it appears in our tree only because `agents` pins it as a peer. `chanfana` and `@hono/zod-openapi` — both require a router (Hono or itty) running *inside* the Worker beside React Router's handler, to emit a JSON file.

---

## 2. The MCP server

```ts
// app/routes/mcp.ts — a React Router resource route, not a second app
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";   // NOT "agents/mcp"
```

```jsonc
// wrangler.jsonc
"run_worker_first": ["/mcp"]
```

Five tools, one per thing a human can see. Each takes the workspace from the authenticated key, never from an argument — a `workspaceId` parameter would be an authorization bug wearing a schema.

| Tool | Returns | Backed by |
|---|---|---|
| `get_standing` | this week's rank, score, movement per ON brand, and the why-line | `standing`, `digest.payload_json` |
| `list_competitors` | ON, off and dismissed brands with their identity cards and state | `entity` |
| `list_alerts` | the alerts feed, filterable by kind and since | `alert` |
| `get_competitor` | one brand's ads, site changes, mentions and hiring for a window | `signal` via the `mention` and `change` views |
| `get_brief` | the latest weekly brief as structured data | `digest` |

Configuration that is load-bearing and easy to miss, each from `docs/REBUILD-STACK.md` §7.1:

- **`run_worker_first: ["/mcp"]`** or static assets shadow the endpoint.
- **`allowedHostnames` / `allowedOriginHostnames` set explicitly** — the default allowlist covers only localhost and `workers.dev`, so a custom domain fails without this.
- **The handler must not be the Worker's default export.** Wrangler treats a function default export as a `WorkerEntrypoint` class. It is composed inside the resource route, which is why Candidate B has no collision with `workers/app.ts` at all.
- **Transport is Streamable HTTP.** SSE is deprecated both by Cloudflare and by the 2026-07-28 spec, which names only stdio and Streamable HTTP.
- `handler.fetch(request, { authInfo, parsedBody })` is the documented hook for exactly our case: an outer framework that has already parsed the request.

---

## 3. Rate limiting: two mechanisms, two jobs

This is the part most likely to be built as one thing, and it must be two.

| Layer | Mechanism | Job | Why not the other one |
|---|---|---|---|
| **Edge abuse shield** | Cloudflare rate-limit binding, `{ "ratelimits": [{ "name": "API_RL", "namespace_id": "1001", "simple": { "limit": 100, "period": 60 } }] }`, called as `await env.API_RL.limit({ key })` **before any D1 read** | stop floods cheaply, per IP and per path | it is **per-colo**, eventually consistent, and documented as *"intentionally designed to not be used as an accurate accounting system"*. Metering a plan with it under-counts across colos. |
| **Billable quota** | `apikey.rateLimitMax` / `rateLimitTimeWindow` / `remaining` / `refillInterval`, enforced by `@better-auth/api-key` | the customer's plan entitlement | the binding cannot be exact and cannot persist per key. |

**`period` must be `10` or `60`. There is no other value.** A packet that writes `period: 30` fails at config parse, and that is the good case.

---

## 4. OpenAPI, and the agent-readable surface

**`zod-openapi` 6.0.2**, zero runtime dependencies, peer `zod ^4.0.0` only, no router coupling. It reads zod 4's native `.meta()` with no `extendZodWithOpenApi` monkey-patch.

The shape that matters: `createDocument(...)` is **pure and synchronous**. So the document is generated in the build step and shipped as a static asset — zero runtime cost for a page nobody requests hot, and no chance of the document drifting from the schemas, because it is derived from them.

**One zod schema module is the single source of truth**, imported by three consumers: the route loaders (which `parse` with it), the MCP tools (whose `inputSchema` is it), and the OpenAPI document (which describes it). That is what "zod-shared schemas" means in the brief, and it is the reason a response shape cannot disagree with its documentation.

`z.toJSONSchema()` is **not** the primary, and the stack doc's reasoning holds: it emits JSON Schema, not an OpenAPI document — no `info`, no `paths`, no `servers`, no `securitySchemes`, registry mode returns `{ schemas }` rather than `{ components: { schemas } }`, and `$ref`s are bare ids. Choosing it means hand-writing everything `createDocument` already does on the same engine.

**Bundle discipline:** zod's full-surface export is 86.5 KB gzip and that is not what ships. Server-side schemas in loaders are bounded only by the 64 MiB Worker limit; **anything reaching the browser bundle uses `zod/mini`** (an object schema is 13.1 KB with `zod`, 4.0 KB with `zod/mini`). Home's 150 KB gzip budget is real.

**`/llms.txt`** per the spec's v2 (2024-09-03, modified 2026-08-10): an H1, a blockquote summary, and one H2 section per public surface, generated from the same route manifest as the sitemap. **No `llms-full.txt`** — it is not in the spec, and Cloudflare's own is 56.7 MiB, which is the argument against.

---

## 5. Data flow, against schema tables by name

1. **`apikey`** — generated by `npx auth@latest generate` with the `apiKey()` plugin. **It is not in `migrations/0001_rebuild.sql`.** The six auth tables the product needs are `user`, `session`, `account`, `verification`, `passkey`, `apikey`, and the shipped migration carries only the first four. Adding the last two is an additive migration and P8.1 owns it.
2. A request arrives at `/mcp` or `/api/*`. The edge rate-limit binding is called **first**, before any D1 read.
3. `@better-auth/api-key` resolves the bearer token to a user and a session, decrements `remaining`, and increments `requestCount`. A key over quota gets 429 with the reset time.
4. The workspace is derived from the authenticated user, never from a parameter.
5. Reads join through `workspace_id` on every table. Because `source` is deliberately platform-scoped with **no** `workspace_id`, source metadata is the one thing safe to return unscoped — and it is the one place a reviewer should check that nothing tenant-specific leaked into it.
6. `entity.state = 'off'` is respected identically to the UI. An agent must not be able to read what the UI hides; that would make OFF a lie.
7. Read-only. No tool mutates. Turning a competitor on or off through the API is a v2 decision and is not in the charter's sentence.

---

## 5b. Jev decisions used (none owned, and none called)

This engine **owns no decision and makes no Jev call**. Every judgment an agent can read — D1's competitor verdicts, D3/D3s change verdicts, D4's picks, D5/D6 on mentions, D8 collapses, D9 page roles — was made in the collection pipeline and stored in `jev_verdict` and on the `signal` rows.

What the API and the MCP tools **do** expose is the verdict as data, because an agent that cannot see why an item was kept is being asked to trust a number: each returned item carries its `question_id`, `p`, and Jev's one-line reason, marked as Jev's read. An item without a verdict is returned as `"unreviewed"` — the same word the UI uses — never silently as confirmed.

**An API call must never trigger a judgment.** A tool that called Jev on read would make an unauthenticated-adjacent surface into a per-request seat cost and a per-request latency, and it would produce verdicts outside the Workflow that logs them. The read surface reads.

---

## 6. Workflow / Queue / cron layout

**None.** This engine is a synchronous read surface. It has no cron, no queue, no Workflow, and it must acquire none — every number it returns was computed by engines 1–7 and stored. An API endpoint that triggers a crawl is how a read surface becomes a cost surface.

The only concurrency control is the rate-limit binding (§3), and the only scheduled thing touching this engine is `apikey`'s own refill, which the plugin handles.

---

## 7. Cost line

**Unit of work = 1,000 API or MCP calls.**

| Resource | Units per 1k calls | Rate | Cost |
|---|---|---|---|
| Workers requests | 1,000 | 10M/mo included | $0.00 |
| Workers CPU | ~1,000 × ~5 ms | 30M CPU-ms/mo included | $0.00 |
| D1 rows read | ~50,000 (indexed reads over `standing`, `entity`, `alert`, `signal`) | 25 billion/mo included, then $0.001/M | $0.00 |
| D1 rows written | **~1,000** (`apikey.requestCount`/`remaining` — **one write per call**) | 50M/mo included, then $1.00/M | $0.00 |
| Rate-limit binding | 1,000 | no separate charge | $0.00 |
| KV | **0** | — | $0.00 |
| **Browser Rendering** | **0** | — | $0.00 |

### Monthly at 100 brands

100 brands across ~25 workspaces. Assume every workspace has an agent connected making 200 calls a day — deliberately generous, since this is a new surface:

| Resource | Monthly | Against included | Cost |
|---|---|---|---|
| Calls | 25 × 200 × 30 = **150,000** | 1.5% of 10M requests | $0.00 |
| D1 rows read | ~7.5M | 0.03% of 25 billion | $0.00 |
| D1 rows written (quota counters) | **150,000** | 0.3% of 50M | $0.00 |
| **Cloudflare total** | | | **$0.00** |

**The one line to watch is `apikey`'s counter write — one D1 row written per API call.** It is the only per-request write in the product. At 150,000 calls/month it is 0.3% of the allowance and irrelevant. It stops being irrelevant around **50 million calls a month**, at which point the honest move is the plugin's own refill window rather than a per-call decrement. Recording the number here means that conversation starts with arithmetic instead of alarm — and it is the same class of mistake as the 2026-09-17 rows-written bill, caught at design time.

**KV is zero on purpose.** Candidate A would have introduced `OAUTH_KV`, and KV writes cost 10× reads with a 1-write-per-second-per-key cap. Not adopting OAuth keeps that at zero too.

---

## 8. Failure modes and the degraded state

| Failure | Detection | Degraded state |
|---|---|---|
| **Wrong import path** — `createMcpHandler` from `agents/mcp` instead of `agents/mcp/server` | it *works*, and silently uses the legacy overload | the worst failure here, because nothing goes red. P8.2 pins it with a test asserting the resolved function and that **no Durable Object binding and no `migrations` block exist** in `wrangler.jsonc`. |
| `allowedHostnames` unset on the custom domain | every real request rejected; localhost fine | caught by the production probe in P8.2, never by local dev. |
| Static assets shadow `/mcp` | 404 or an HTML page where JSON belongs | `run_worker_first: ["/mcp"]`; asserted in the same test. |
| Key over quota | `apikey.remaining` at 0 | 429 with the reset time and the plan's limit. Settings shows usage against the limit. Never a silent truncation of results. |
| Edge rate limit hit | binding returns `success: false` | 429 before any D1 read. Per-colo, so a legitimate burst from one region may trip while another does not — documented in the API docs, because an undocumented eventually-consistent limit reads as a bug. |
| Interactive MCP client cannot discover auth | connection fails at the client | **expected, by §1's decision.** Settings' "Connect your agent" shows the `Authorization: Bearer` header alongside the URL, and the docs say the server uses bearer tokens rather than OAuth. A client that cannot set a header is not supported in v1, and we say so. |
| OpenAPI document drifts from the routes | impossible by construction | it is generated from the same zod modules the loaders parse with. A drift means someone hand-wrote a document; P8.3 forbids it. |
| Agent reads an OFF brand | tenancy/state test | a scoping bug and treated as one: OFF must mean OFF on every surface. Pinned by a test, not by review. |

---

## PACKETS

---

### P8.1 — The `apikey` and `passkey` tables, and "Connect your agent"

**GOAL.** Add `@better-auth/api-key` and `@better-auth/passkey` to the better-auth config, run `npx auth@latest generate` and land the two tables the shipped `0001_rebuild.sql` is missing — `apikey` (22 columns) and `passkey` — as an additive migration. Build the Settings "Connect your agent" panel: create a key, name it, show it **once**, list keys by `start`/`prefix` with `lastRequest` and `remaining`, and revoke. The panel shows the **MCP URL and the `Authorization: Bearer` header together** — per §1 the server is bearer-authenticated, not OAuth, so a URL on its own is an incomplete instruction. Per-key quota comes from the plan's entitlements in `plan.limits_json`.

**STOCK FEATURE OR LIBRARY.** `@better-auth/api-key` **1.7.5** (`apiKey()`, `API_KEY_TABLE_NAME === "apikey"`), `@better-auth/passkey` **1.7.5**, `better-auth` **1.7.5**, CLI `npx auth@latest generate --adapter kysely`. The binding goes straight to `database:` — better-auth ships its own D1 Kysely dialect, selected by duck-typing the binding.

**FILES IN SCOPE.** `app/lib/auth.server.ts`, `app/routes/settings.agent.tsx`, `migrations/` for the generated `apikey` and `passkey` DDL only, `package.json`.

**FORBIDDEN.** A hand-written key table, hash, quota counter or revocation flag — every one of those is a column the plugin generates. `npx @better-auth/cli` (deprecated, stuck at 1.4.21 from 2026-03-01). `kysely-d1` (the dialect ships in the box). `better-auth-cloudflare` (a community meta-package with its own provisioner — glue by definition). Storing the full key after creation. Showing a key more than once. Running `getMigrations()` against production.

**PROOF REQUIRED.** `npx auth@latest generate` output pasted, the emitted DDL diffed against what lands in `migrations/`, and `wrangler d1 migrations apply` output. One real key created through the UI on production: cite the `apikey` row's `id`, `start`, `prefix`, `rateLimitMax`, `remaining` and `createdAt`, one authenticated call using it, and the `requestCount` incrementing. Screenshots at 1440 and 390. **Note for the worker:** better-auth validates its schema at runtime in production, so a drift between the migration and the plugin's expectation is a 500 on first request, not a warning — verify a real sign-in after applying.

**PUSH.** Branch `engine/api-keys` off `origin/main`, pushed within 5 minutes.

**COST.** One D1 row written per API call thereafter (`requestCount`/`remaining`). At 150,000 calls/month that is 0.3% of the 50M included. $0.00.

---

### P8.2 — The MCP server, stateless, inside a resource route

**GOAL.** `/mcp` as a React Router resource route composing `createMcpHandler` from **`agents/mcp/server`** with an `McpServer` from `@modelcontextprotocol/server`, exposing the five tools in §2. Workspace comes from the authenticated key, never from a tool argument. `run_worker_first: ["/mcp"]` and explicit `allowedHostnames` / `allowedOriginHostnames` for the production domain. Streamable HTTP transport.

**STOCK FEATURE OR LIBRARY.** `agents` **0.24.0**, `@modelcontextprotocol/server` **2.0.0** (plus the exact-pinned peers `@modelcontextprotocol/client@2.0.0` and `@modelcontextprotocol/sdk@1.30.0`, which `agents` requires non-optionally — verified in its manifest), `zod` **4.6.5**.

**FILES IN SCOPE.** `app/routes/mcp.ts`, `app/lib/mcp/tools.ts`, `wrangler.jsonc` (`run_worker_first` only).

**FORBIDDEN.** **`McpAgent`, or importing `createMcpHandler` from `agents/mcp`** — that path exports the legacy overload under the same name (verified: `agents/mcp/server` aliases `createStatelessMcpHandler`). Any `durable_objects`, `migrations` or `new_sqlite_classes` block in `wrangler.jsonc`. SSE transport. Making the handler the Worker's default export. A `workspaceId` tool argument. Any tool that mutates or that triggers a crawl. Starting from `cloudflare/ai/demos/remote-mcp-*` (Cloudflare's own docs say not to). Removing `@modelcontextprotocol/sdk` from `package.json` as "unused" — it is a required peer.

**PROOF REQUIRED.** A real MCP client session against **production**, not localhost: `tools/list` returning the five tools, and one real call per tool against a real workspace with at least four ON brands, with the returned values matched against the D1 rows they came from (cite ids). Plus the negative proofs: `wrangler.jsonc` grepped for `durable_objects`/`migrations` showing none; a request to `/mcp` proving an asset does not shadow it; and a request from a disallowed origin rejected.

**PUSH.** Branch `engine/mcp-server`.

**COST.** Zero standing cost — no cron, no queue, no Workflow, no KV, no Durable Object. Per call: 1 Workers request, ~50 D1 rows read, 1 quota row written. $0.00 at 100 brands.

---

### P8.3 — Shared zod schemas, the read API, and the generated OpenAPI document

**GOAL.** One zod module is the single source of truth for every API shape, imported by three consumers: the route loaders that parse with it, the MCP tools whose `inputSchema` it is, and the OpenAPI document that describes it. Ship `/api/*` read routes mirroring the five tools, and generate the OpenAPI 3.1 document **at build time** into a static asset served at `/api/openapi.json`. Add `/llms.txt`.

**STOCK FEATURE OR LIBRARY.** `zod` **4.6.5** with native `.meta()`, `zod-openapi` **6.0.2** `createDocument` (pure, synchronous, zero runtime deps, no router coupling, no `extendZodWithOpenApi` monkey-patch). React Router 8 resource routes. `llms.txt` spec v2.

**FILES IN SCOPE.** `app/lib/api/schemas.ts`, `app/routes/api.*.ts`, `app/routes/llms[.]txt.ts`, the build step that emits `openapi.json`, `package.json`.

**FORBIDDEN.** A hand-written OpenAPI document or a hand-edited `paths` object that is not derived from the schemas. `chanfana` or `@hono/zod-openapi` — both require a router inside the Worker beside React Router's handler. `z.toJSONSchema()` as the document generator (it emits no `info`, `paths`, `servers` or `securitySchemes`, and its `$ref`s are bare ids). A second schema library. Full `zod` in the browser bundle — use `zod/mini` for anything client-side. `llms-full.txt` (not in the spec; Cloudflare's own is 56.7 MiB). Any response shape defined anywhere but the shared module.

**PROOF REQUIRED.** The generated `openapi.json` validated by a spec validator with the output pasted, and each of the five endpoints called live on production with its real response diffed against its documented schema. Proof the document is a build artifact, not a runtime route (show it in the assets output). A grep proving no `paths` object is hand-maintained. `/llms.txt` fetched from production with its content. Measured browser-bundle delta from zod.

**PUSH.** Branch `engine/api-openapi`.

**COST.** OpenAPI generation is build-time, so zero runtime cost. Read endpoints priced with P8.2. $0.00.

---

### P8.4 — Two rate limits, for two different jobs

**GOAL.** Wire the Cloudflare rate-limiting binding as the **edge abuse shield** — called per IP and per path **before any D1 read** — and leave the **billable quota** entirely to `apikey.rateLimitMax`/`rateLimitTimeWindow`/`remaining`. Document both in the API docs, including that the edge limit is per-colo and eventually consistent, so a burst tripping in one region and not another is expected rather than a bug.

**STOCK FEATURE OR LIBRARY.** `{ "ratelimits": [{ "name": "API_RL", "namespace_id": "1001", "simple": { "limit": 100, "period": 60 } }] }` and `await env.API_RL.limit({ key })`. `@better-auth/api-key`'s own quota columns.

**FILES IN SCOPE.** `wrangler.jsonc` (ratelimits block), `app/lib/api/guard.ts`, `app/routes/api.*.ts` (the guard call only), `docs/` API reference.

**FORBIDDEN.** **Using the rate-limit binding to enforce a plan entitlement** — it is per-colo and documented as *"not… an accurate accounting system"*, so metering a customer with it under-counts across colos, which is a billing bug by construction. A `period` other than `10` or `60` (no other value exists). A hand-written counter in D1 or KV. Calling the limiter after a D1 read. A per-request KV write for counting (KV writes cost 10× reads and cap at 1/s/key).

**PROOF REQUIRED.** Real runs against production: (a) exceed the edge limit from one IP and show the 429 arriving **before** any D1 query (proven from the query log or a timing/trace showing no D1 call); (b) exhaust one key's quota and show the 429 with the reset time, `apikey.remaining` at 0, cited by row; (c) show the two are independent — a key under quota still shielded by the edge limit, and a key over quota rejected even from a fresh IP.

**PUSH.** Branch `engine/api-rate-limits`.

**COST.** The binding has no separate charge. The quota costs one D1 row written per call, already counted in P8.1. $0.00.
