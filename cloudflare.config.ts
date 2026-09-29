import { bindings, defineConfig, exports, triggers } from "cf/config";

/**
 * Worker config for Five to Nine (0509) — the cf CLI's config file
 * (0509#6083, part 1 of #5916). wrangler.jsonc stays the deploy config until
 * the later parts switch the deploy workflows over; keep the two in step.
 *
 * The Worker name stays "0509" on purpose: Worker secrets are scoped to the
 * name, so renaming it would orphan DODO_API_KEY, BETTER_AUTH_* and the rest,
 * and the first deploy would come up unconfigured.
 *
 * Declares only what this app uses. The pre-rebuild Worker carried Workflow and
 * Durable Object classes, eight rate-limit bindings and eight cron triggers;
 * none are here, because nothing in this app reads them. Bindings come back one
 * at a time, with the engine packet that needs them.
 *
 * wrangler.jsonc's `upload_source_maps: true` has no cf field: `cf deploy`
 * uploads the source maps in the Vite build output instead of taking a config
 * flag, so Worker source maps follow the build's `sourcemap` setting.
 */
export default defineConfig({
	worker: {
		name: "0509",
		// >= 2026-08-04, so nodejs_compat is on by default and needs no flag.
		compatibilityDate: "2026-09-16",
		// Agent sign-in (@cloudflare/workers-oauth-provider) fetches a client's
		// Client ID Metadata Document by URL; this flag keeps that fetch on the
		// public internet so a client_id can never reach this zone's own origin.
		compatibilityFlags: ["global_fetch_strictly_public"],
		entrypoint: "./workers/app.ts",
		observability: {
			// p95 request duration per route comes from here, which is how
			// docs/REBUILD-DONE.md's performance gate gets measured without a load
			// generator pointed at production.
			enabled: true,
		},
		assets: {
			runWorkerFirst: ["/mcp"],
		},
		domains: [
			"0509.io",
			"www.0509.io",
			"api.0509.io",
			// The .in hosts are deliberately absent. Their 308 to the .io twins is a
			// zone-level Redirect Rule on the 0509.in zone (phase
			// http_request_dynamic_redirect, ruleset f7743879d6904ebea189b42c85713069),
			// which runs before the Worker and costs no invocation. Adding a route here
			// would put the Worker in that path for nothing.
		],
		exports: {
			// The pre-rebuild Worker declared one Durable Object class,
			// SelectionEnrichmentLease (tag v1, new_sqlite_classes). The fresh app does
			// not export it, and Cloudflare refuses a version that drops a class still
			// backing live Durable Objects:
			//
			//   New version of script does not export class 'SelectionEnrichmentLease'
			//   which is depended on by existing Durable Objects [code: 10064]
			//
			// A delete-class migration is the mechanism the error itself names. This
			// deletes the objects along with the class, which is correct here: the lease
			// was ad-hoc coordination for the old selection pipeline, that pipeline is
			// gone, and there are 0 users. `state: "deleted"` is the cf form of
			// wrangler's deleted_classes migration.
			SelectionEnrichmentLease: exports.durableObject({ state: "deleted" }),
			// The live Durable Object, created as a sqlite class by the v3
			// migration in wrangler.jsonc; the BROWSER_BUDGET binding below binds it.
			BrowserBudget: exports.durableObject({ storage: "sqlite" }),
			// The eight Workflows (comments on their bindings in `env` below).
			// Each key is the class exported from workers/app.ts; `name` is the
			// workflow identifier and `schedules` is the workflow's own cron,
			// separate from the Worker-level triggers.
			// standing-rollover has no schedule of its own: the nightly Worker
			// cron re-creates each workspace's instance.
			StandingRolloverWorkflow: exports.workflow({ name: "standing-rollover" }),
			DiscoveryWorkflow: exports.workflow({ name: "competitor-discovery" }),
			SiteSweepWorkflow: exports.workflow({ name: "site-sweep", schedules: ["0 2 * * *"] }),
			SnapshotBackupWorkflow: exports.workflow({ name: "snapshot-backup", schedules: ["0 5 * * *"] }),
			AccountDeleteWorkflow: exports.workflow({ name: "account-delete" }),
			OwnSiteCheckWorkflow: exports.workflow({ name: "own-site-check", schedules: ["0 * * * *"] }),
			MentionsWorkflow: exports.workflow({ name: "mentions-sweep", schedules: ["0 1 * * *"] }),
			IdentityTailWorkflow: exports.workflow({ name: "identity-tail" }),
		},
		triggers: [
			// The dead-man ping, every five minutes: an external service alerts when
			// the reports stop, which is the one failure a Worker cannot report about
			// itself. Also the nightly delivery sweeper, which re-enqueues stale
			// pending digests and claims, and the Monday 04:00 UTC D2 competitor
			// refresh.
			triggers.scheduled({
				schedule: "*/5 * * * *",
			}),
			triggers.scheduled({
				schedule: "0 3 * * *",
			}),
			triggers.scheduled({
				schedule: "0 4 * * 1",
			}),
			// The one send lane (0509#3979, docs/engines/delivery.md § P7.2, §5).
			// The weekly brief (engine 6) and the incident email (engine 4) both write
			// their row and put `{ digest_id }` on `send-email`; this consumer is the
			// only thing that calls EMAIL.send. The numbers are the packet's, not
			// defaults: max_batch_size 1 because each send is its own API call and a
			// partial batch failure is ambiguous; max_concurrency 2 because Email
			// Service is Beta with unpublished, reputation-gated daily limits and a cold
			// domain, so two concurrent sends clears a 25-workspace Monday without
			// looking like a blast. The dead letter queue is mandatory — messages that
			// reach the retry limit are deleted permanently otherwise, and a silently
			// dropped brief is the failure the contract forbids.
			triggers.queue({
				deadLetterQueue: "send-email-dlq",
				maxBatchSize: 1,
				maxBatchTimeout: 30,
				maxConcurrency: 2,
				maxRetries: 5,
				name: "send-email",
			}),
			// #4065: a message that exhausts send-email lands here and becomes one alert.
			triggers.queue({
				maxBatchSize: 1,
				maxBatchTimeout: 30,
				maxRetries: 3,
				name: "send-email-dlq",
			}),
		],
		env: {
			// BETTER_AUTH_URL must be the canonical origin, never derived from a
			// forwarded header: auth origin trust and the magic-link URL both come from
			// it, and a client-supplied value would let a link point anywhere.
			// BETTER_AUTH_SECRET stays a Worker secret.
			// TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY are Worker secrets too. The
			// secret() binding makes deploy inherit the values already on the Worker
			// instead of replacing them with a plaintext var.
			// LANDING_WORKSPACE_ID: the public workspace we run ourselves whose changes the landing ticker shows (#4083). Empty renders an empty strip, never filler.
			// ACCESS_TEAM_DOMAIN / ACCESS_AUD pin the Access application that fronts
			// 0509.io. They are public identifiers — the AUD appears in Access's own
			// login redirect — not secrets. access-preclearance.server.ts uses them to
			// verify the `cf-access-jwt-assertion` JWT Access forwards on every
			// authenticated request; a verified service-token assertion pre-clears the
			// magic-link captcha (#4702's accepted path for the e2e lane, #5631).
			BETTER_AUTH_URL: bindings.text("https://0509.io"),
			LANDING_WORKSPACE_ID: bindings.text(""),
			ACCESS_TEAM_DOMAIN: bindings.text("https://nish345.cloudflareaccess.com"),
			ACCESS_AUD: bindings.text("b4fa400a1848c913b92c3212dc0714fcdbd1b1b66eb24659e4a7cc01c790575d"),
			BETTER_AUTH_SECRET: bindings.secret(),
			TURNSTILE_SECRET_KEY: bindings.secret(),
			TURNSTILE_SITE_KEY: bindings.secret(),
			// Mentions telemetry (#4003 slice 3/6, docs/engines/mentions.md P5.4).
			MENTIONS_SOURCES: bindings.analyticsEngineDataset({
				name: "mentions_sources",
			}),
			DB: bindings.d1({
				name: "0509",
				id: "746c6e3d-782e-443a-82d6-28ca93a16294",
			}),
			// Identity probe cache (engine 1, issue #4419): a read-through cache for
			// probe results keyed identity:<registrable>:<probe> with a 24-hour TTL
			// (docs/engines/identity-card.md P1, graft 1). KV only, for the same reason
			// the doc picks it: the cache is read-mostly, tolerant of the 60-second
			// propagation window and never same-key hot (docs/REBUILD-STACK.md §4.5).
			//
			// The id is pinned (#4631). The production CLOUDFLARE_API_TOKEN cannot
			// reach the KV namespaces endpoint, so an id-less binding sends deploy to
			// provision-time namespace creation and every deploy fails with auth error
			// 10000 — the same failure 225c3eb fixed for the e2e inbox. The namespace
			// is 0509-identity-cache, the name provisioning would have given it.
			// tests/wrangler-bindings.test.ts keeps every deployed config pinned.
			IDENTITY_CACHE: bindings.kv({
				id: "583a3ce85fac4da0b811902674481663",
			}),
			// OAUTH_KV holds agent sign-in state for @cloudflare/workers-oauth-provider:
			// registered AI apps, grants, and hashed tokens (docs/REBUILD-STACK.md §7.2).
			// Namespace 0509-oauth, pinned for the same reason as the one above.
			OAUTH_KV: bindings.kv({
				id: "c74722e9898d4ea5948e50110d2b9f20",
			}),
			// Two bindings for two buckets (#4569 had added a second binding to the
			// same bucket; a second bucket is a different thing). snapshot/site/ holds
			// raw site snapshots, text and screenshot (engine 4), under the one-year
			// snapshot/ rule in docs/REBUILD-GUARDRAILS.md. 0509-snapshots-backup is the
			// nightly copy target of the snapshot-backup Workflow below and carries the
			// same five per-prefix lifecycle rules, so a copied object ages out of the
			// backup a year behind the source.
			SNAPSHOTS: bindings.r2({
				name: "0509-snapshots",
			}),
			SNAPSHOTS_BACKUP: bindings.r2({
				name: "0509-snapshots-backup",
			}),
			// Transactional send only. The weekly brief's standing on this lane is an
			// open question recorded on docs/REBUILD-DELIVERY.md.
			EMAIL: bindings.sendEmail({}),
			SEND_EMAIL: bindings.queue({
				name: "send-email",
			}),
			// The durable tail of a confirmed identity card puts work on fetch-sweep;
			// the consumer that drains it is a later engine, and this Worker's queue()
			// handler is the email lane.
			FETCH_SWEEP: bindings.queue({
				name: "fetch-sweep",
			}),
			// Self-binding to the BrowserBudget class declared in `exports` above.
			BROWSER_BUDGET: bindings.durableObject({
				worker: "0509",
				exportName: "BrowserBudget",
			}),
			// Jev, the typed-decision model (docs/REBUILD-JEV.md), runs as the Workers AI
			// model typesafe/jev through AI Gateway, paid from the account's AI Gateway
			// credits (unified billing). No provider key lives in this Worker.
			AI: bindings.ai({}),
			// Browser Rendering: brand pages bot-gate a plain workerd fetch, so every
			// arbitrary-homepage read goes through real Chrome. Measured ~7 s per ads
			// pull; the cost model turns on keeping concurrency at or under the included
			// ten (docs/REBUILD-COST.md).
			//
			// Since P3 (#3971) it is the escalation target of the fetch-then-browser
			// transport in app/lib/fetch/transport.ts: that module tries a plain `fetch`
			// first and only reaches for this binding when the fetch is refused, so the
			// binding now backs the interactive path as well as the sweep path.
			BROWSER: bindings.browser({}),
			// The abuse shield in front of /mcp and /api/v1, keyed per user
			// (docs/REBUILD-STACK.md §7.4). Per-colo and approximate by design; the exact
			// per-key quota is the apikey row's own rate limit.
			AGENT_LIMIT: bindings.rateLimit({
				namespace: "5091",
				simple: {
					limit: 120,
					period: 60,
				},
			}),
			// Sign-in link sends, checked in a better-auth before-hook so the /login
			// form and a direct POST to /api/auth/sign-in/magic-link are both covered.
			// Per address (hashed) it stops one inbox being flooded; per IP it slows a
			// sender spraying many addresses. The IP ceiling leaves room for the
			// production e2e run, which signs in about a dozen times from one runner.
			SIGN_IN_EMAIL_LIMIT: bindings.rateLimit({
				namespace: "5092",
				simple: {
					limit: 5,
					period: 60,
				},
			}),
			SIGN_IN_IP_LIMIT: bindings.rateLimit({
				namespace: "5093",
				simple: {
					limit: 20,
					period: 60,
				},
			}),
			// Open AI-app registration (/oauth/register) writes a 30-day client row to
			// OAUTH_KV per call; per client IP, a real app registers once.
			AGENT_REGISTER_LIMIT: bindings.rateLimit({
				namespace: "5094",
				simple: {
					limit: 10,
					period: 60,
				},
			}),
			// Onboarding identity probes, per user; each probe is a site fetch and possibly a Browser Rendering session.
			PROBE_LIMIT: bindings.rateLimit({
				namespace: "5095",
				simple: {
					limit: 10,
					period: 60,
				},
			}),
			// The weekly rollover (docs/engines/standing-home.md §2 and P6.3, 0509#4004).
			// One instance per workspace per week, id `rollover-<workspace>-<closing
			// instant>`. The nightly cron re-creates the next one with createBatch,
			// which skips an id that already exists, so a lost instance is replaced
			// within a day and a live one is never started twice.
			STANDING_ROLLOVER: bindings.workflow({
				name: "standing-rollover",
				worker: "0509",
				exportName: "StandingRolloverWorkflow",
			}),
			// Competitor discovery (docs/engines/competitor-discovery.md): one instance
			// when a workspace confirms its card, then one per workspace per night.
			DISCOVERY: bindings.workflow({
				name: "competitor-discovery",
				worker: "0509",
				exportName: "DiscoveryWorkflow",
			}),
			// The nightly website sweep (docs/engines/site-change.md). The Workflow's
			// own schedule creates one instance a night, at 02:00 UTC so the changes
			// it files land before the 03:00 standing refresh counts them. Each page
			// is its own retried step; a page that cannot be read fails alone.
			// Nothing to provision: deploy creates the Workflow, unlike a queue.
			SITE_SWEEP: bindings.workflow({
				name: "site-sweep",
				worker: "0509",
				exportName: "SiteSweepWorkflow",
			}),
			// The nightly snapshot backup (0509#5802): copies every object in
			// 0509-snapshots that 0509-snapshots-backup does not yet hold, one
			// retried step per page of up to 200 objects, preserving httpMetadata.
			// 05:00 UTC: after the 01:00 mentions sweep and the 02:00 site sweep
			// have written their objects, and clear of the 03:00 standing cron and
			// the Monday 04:00 refresh. No deletes are propagated — an object deleted
			// from the source ages out of the backup by the backup's own lifecycle
			// rules.
			SNAPSHOT_BACKUP: bindings.workflow({
				name: "snapshot-backup",
				worker: "0509",
				exportName: "SnapshotBackupWorkflow",
			}),
			// Deleting an account (Settings): better-auth deletes the user and the
			// database cascades every owned row; this Workflow empties the account's
			// stored files, one retried step per page of up to 1,000 objects.
			ACCOUNT_DELETE: bindings.workflow({
				name: "account-delete",
				worker: "0509",
				exportName: "AccountDeleteWorkflow",
			}),
			// The own-site watch: every hour, each customer's own homepage is
			// probed once with a plain fetch. A 5xx, 404 or no answer is probed
			// again five minutes later, and only then opens an incident, pins an
			// alert and puts { incident_id } on send-email. An open incident whose
			// page answers cleanly again is closed and gets the one "looks fixed"
			// email. This is the hourly re-check the incident email promises.
			OWN_SITE_CHECK: bindings.workflow({
				name: "own-site-check",
				worker: "0509",
				exportName: "OwnSiteCheckWorkflow",
			}),
			// The nightly news sweep (docs/engines/mentions.md): GDELT and Hacker
			// News, one step per brand per source, paced for GDELT's one request per
			// five seconds. 01:00 UTC so its alerts land before the 03:00 standing
			// refresh counts them.
			MENTIONS: bindings.workflow({
				name: "mentions-sweep",
				worker: "0509",
				exportName: "MentionsWorkflow",
			}),
			// The durable tail of a confirmed identity card: persist, seed watches,
			// start discovery, enqueue the first collection. Producer only — the
			// consumer that drains fetch-sweep is a later engine, and this Worker's
			// queue() handler is the email lane.
			IDENTITY_TAIL: bindings.workflow({
				name: "identity-tail",
				worker: "0509",
				exportName: "IdentityTailWorkflow",
			}),
		},
	},
});
