# 0509 agent-native self-serve benchmark

Date: 2026-06-18

Updated: 2026-06-19 after the first audited agent-action tranche shipped.

> Historical strategy note. This memo predates the final self-serve GA hardening
> branch. Do not use it as current launch truth for Slack, Collections naming,
> Presence/social connector status, auth provider details, PR/deploy state, or
> final owner gates. Use `docs/final-self-serve-ga-scorecard.md` and
> `docs/launch-hardening-progress.md` for the current branch posture.

## Verdict

0509 should not try to win by becoming a larger ad database. Foreplay already claims a live MCP, API, broad ad search, boards, and competitor tracking at large scale. The sharper opportunity is to own a narrower but more valuable job:

> A proof-backed competitor operations desk that agents can safely operate end to end.

That means customers and their agents can set up monitoring, tune what matters, verify proof, route alerts, create reports, and preserve the reasoning trail without Nish or an operator touching the account.

## What 0509 already has

0509 is not starting from zero. The current product already has:

- Public read-only search and sample proof loop.
- First-run onboarding that creates a watchlist from one competitor site.
- Watchlists, watch events, proof captures, digests, boards, reports, share links, and exports.
- Dodo-backed checkout, proof-credit packs, billing portal redirect, and signed billing webhooks.
- Cloudflare Email delivery and self-serve Slack incoming-webhook setup.
- Better Auth with D1 as the auth and product-data authority.
- Customer API and MCP exports for account-owned readiness, collections, watchlists, digests, memory, and client rooms.
- A write-enabled, audited agent-action beta for `watchlist.create`, `watchlist.update`, `watchlist.refresh`, `watchlist.pause`, `watchlist.resume`, `collection.create`, `proof.add_external`, `share.create`, `report.create`, `report.share`, `counter_move_brief.create`, `memory.upsert`, `memory.list`, `client_room.upsert`, `client_room.list`, `delivery_targets.list`, `delivery_settings.update`, `delivery_target.update`, and `web_mentions.list`.
- Write actions require a write-enabled API key, owner-scoped resources, idempotency on retryable mutations, audit records, and secret redaction.

The live public posture remains pilot-ready, not broad launch-ready, until production canaries show recent proof capture, digest delivery, Slack delivery, Dodo portal subscription updates, and external uptime monitoring are confirmed.

## Competitive benchmark

### Ad inspiration and ad-library products

Examples: Foreplay, MagicBrief, Minea, BigSpy, AdSpy, Adbeat.

Strengths:

- Big searchable ad datasets.
- Creative inspiration, hooks, transcripts, boards, and creative workflow.
- Some have APIs and MCP. Foreplay now advertises an MCP connector for Claude and ChatGPT, plus access to discovery, boards, swipe files, Spyder watchlists, and brand analytics.
- Adbeat has competitor-new-ad alerts, advertiser comparison, placement data, and enterprise display intelligence.
- Minea and BigSpy compete on huge ad databases, product discovery, trend tracking, and low entry price.

Weaknesses 0509 can exploit:

- They are mostly research and inspiration databases first.
- They optimize for "find winning ads", not "tell me exactly what changed since last night and prove it".
- They do not obviously own a buyer-trust loop around proof policy, delivery certainty, source status, and action history.
- MagicBrief is closing on July 31, 2026, which creates buyer migration noise but also shows the ad-creative workflow category is consolidating around larger creative suites like Canva.

Implication:

- 0509 cannot differentiate with "MCP exists" or "search ads from chat". Foreplay is already there.
- 0509 can differentiate with action parity, proof-backed monitoring, and operational trust.

### Enterprise competitive intelligence

Examples: Crayon, Klue, Kompyte.

Strengths:

- Broad source monitoring across websites, reviews, content, social, ads, jobs, and news.
- Sales enablement: battlecards, announcements, newsletters, CRM and Slack integrations.
- AI summarization, importance scoring, win-loss, and seller recommendations.

Weaknesses 0509 can exploit:

- Usually sales-led, heavyweight, and enterprise-priced.
- Optimized for PMM and sales enablement teams, not a lean Indian growth team or agency that wants first value in minutes.
- More "competitive intelligence program" than "proof-backed marketing change alarm".
- AI trust remains a category pain: Klue's own 2026 AI report says many CI teams have AI outputs they cannot stand behind and do not trust AI outputs to go straight to sellers.

Implication:

- 0509 should borrow the battlecard/action layer, but keep the product self-serve, proof-first, and campaign-change-specific.

### Website-change monitoring

Examples: Visualping, Hexowatch.

Strengths:

- Strong website change detection, screenshots, page monitoring, and alert delivery.
- Visualping and Hexowatch both position around no-code monitoring of visual/content/price/source-code/availability changes.

Weaknesses 0509 can exploit:

- They are generic page monitors.
- They lack ad-library context, India-aware campaign scoring, boards, digests, and growth-team action framing.
- They tell users that a page changed, but not necessarily whether a competitor changed an offer, hook, CTA, or campaign motion worth acting on.

Implication:

- 0509 should keep selective rendered proof as a moat, but wrap it in competitor-marketing semantics rather than generic visual diffing.

## Strategic gap

0509 is close to being self-serve as a SaaS surface, and the first safe agent-action layer now exists. The remaining gap is no longer "agents can only read." It is production-grade operations parity:

- Agents can create, update, refresh, pause, resume, share, report, create boards, add external proof, create counter-move briefs, save memory, maintain client rooms, list redacted delivery targets, update delivery policy with explicit approval, pause/resume delivery targets, and read existing narrow web mentions.
- Agents still cannot safely manage every account setup surface a human can manage: billing changes, team invites, Meta source reconnection, secret-bearing integration setup, external delivery sends, automated X/YouTube/social listening, and unsupported-channel ingestion remain intentionally gated or missing.
- The product still needs live operational proof: recent proof capture, digest delivery, Slack delivery, and external uptime monitoring must be visible in canaries before broad self-serve claims are credible.
- The UI and docs need to make the same readiness/action model obvious to customers, not only to API/MCP users.

That is the opening now: make the app and the agent operate the same workspace, then prove the operation is healthy in production.

## Highest-leverage product bet

Harden `Competitor Desk Agent`.

This is now a safe action layer over existing 0509 primitives, not a generic chat box and not a claim that AI replaces the product. The next work is to finish the proof of reliability and expand the action surface only where it stays auditable.

Customer promise:

> Paste competitors. 0509 watches them, proves what changed, and an agent can keep the desk configured, briefed, and report-ready.

Core capabilities:

1. Workspace readiness
   - Shipped: API/MCP readiness for search, first watchlist, proof, digest, Slack, API/MCP, billing, team, memory, and client-room setup.
   - Remaining: make production readiness visible in the app and keep canaries quiet only when the live proof/delivery signals are current.

2. Agent setup parity
   - Shipped: agent can create/update watchlists, set competitor/self role, pause/resume watches, refresh paid watches, create boards, and tune delivery sensitivity with owner checks, plan checks, idempotency, audit logs, and replay guards.
   - Remaining: manage source reconnection without exposing private credentials.

3. Delivery parity
   - Shipped: readiness reports delivery state without returning secrets; agents can list redacted targets, update watchlist delivery settings with explicit approval, and pause/resume existing targets.
   - Remaining: create/retest secret-bearing delivery targets and prove Slack delivery through the app-owned integration flow; never return Slack webhook secrets through tools.

4. Proof and report parity
   - Shipped: agent can create boards, add external proof, create generic share links, build reports, share reports, create counter-move briefs, and carry saved memory context into reports and briefs.
   - Remaining: prove recurring workflow quality with live customer usage and keep report copy aligned to source status.

5. Counter-move briefs
   - Shipped: agent action can generate proof-backed counter-move briefs from account-owned watchlists.
   - Remaining: surface those briefs in recurring customer workflows with owner/channel, expiry, and follow-up state.
   - This is the bridge from monitoring to retained weekly use.

6. Agent memory
   - Shipped: agent can save and list scoped memory, and create/list client rooms.
   - Remaining: make the UI consume that context and use it to tune future digests, briefs, and agency reports.

## Roadmap

### 0. Clear the current launch blockers

- Add a real Slack target and rerun proof/prod canaries.
- Confirm Dodo portal subscription updates.
- Add external uptime monitoring.

Reason: broad self-serve cannot be credible while status still says pilot-ready.

### 1. Deepen the readiness and activation layer

- Shipped: a single workspace readiness object exposed to API and MCP.
- Next: make readiness the dashboard/onboarding control surface, with clear customer actions for proof, digest, Slack, API/MCP, billing, team, memory, and client rooms.
- Next: connect readiness to production canary evidence so the app does not claim readiness from stale setup state.

Reason: this turns scattered SaaS setup into a measurable self-serve loop.

### 2. Expand read-write MCP/API beta with approval gates

Shipped high-value MCP tools:

- `get_workspace_readiness`
- `get_collection_export`
- `get_watchlist_export`
- `get_digest_export`
- `create_watchlist`
- `update_watchlist`
- `pause_watchlist`
- `resume_watchlist`
- `refresh_watchlist`
- `create_collection`
- `add_external_proof`
- `list_delivery_targets`
- `update_delivery_settings`
- `update_delivery_target`
- `create_report`
- `create_share_link`
- `share_report`
- `create_counter_move_brief`
- `upsert_memory`
- `list_memory`
- `upsert_client_room`
- `list_client_rooms`
- `list_web_mentions`

Next MCP/API primitives:

- Secret-bearing source setup with app-owned approval flow
- Recurring workflow follow-up state for counter-move briefs
- `invite_team_member`
- `retest_meta_source`

Rules:

- Owner/admin only for sensitive actions.
- Never expose secrets.
- Idempotency key on writes.
- Every write returns the same confirmation the UI would show.
- Every write is recorded in an audit log.
- Delivery/channel changes use explicit approval.
- Paid scans, billing, team invites, and external sends stay gated.

Reason: this is the real agent-native leap. Foreplay can let agents search data. 0509 should let agents operate a proof-backed monitoring desk safely.

### 3. Activate proof-backed web mentions without overclaiming

Use the existing `web_mention_target` and `web_mention_observation` schema to add competitor/self mention tracking for Reddit, X, blogs, YouTube, Substack, and web.

Keep the claim narrow:

- "Web mentions beta" only after it works.
- Tie mentions to watchlists and proof trails.
- Avoid generic social listening positioning.

Reason: the schema already exists, and competitor/self tracking can create a differentiated "market moved" view if it stays proof-backed.

### 4. Add counter-move briefs

For each high-priority change, generate:

- Change summary.
- Source proof.
- Why it matters.
- Recommended counter-test.
- Suggested creative angle or landing-page response.
- Delivery channel and owner.
- Confidence and expiry.

Reason: this is what converts monitoring into action.

### 5. Make agency/client rooms first-class

- Per-client workspace memory.
- Branded recurring reports.
- Client-safe share links.
- Agent-readable exports by client.
- Agency team controls.

Reason: agencies feel the pain weekly and can justify retained monitoring faster than a solo founder.

## Positioning

Do not lead with "AI agent".

Lead with:

> Proof-backed competitor monitoring that agents can operate.

Homepage-grade language:

> Know what changed overnight. See the proof. Let your team's agent keep the desk ready.

Internal product language:

> The app is the control panel. The agent is the operator. Proof is the trust layer.

## Sources

Local 0509 sources:

- `README.md`
- `docs/launch-readiness.md`
- `docs/auth-runtime.md`
- `app/routes/api.mcp.ts`
- `app/routes/api.v1.ts`
- `app/routes/api.v1.actions.ts`
- `app/routes/api.v1.workspace-readiness.ts`
- `app/routes/app.dashboard.tsx`
- `app/routes/app.watchlists.tsx`
- `app/routes/app.sources.tsx`
- `app/routes/app.onboard.tsx`
- `app/routes/app.billing.tsx`
- `app/lib/customer-agent-actions.server.ts`
- `app/lib/workspace-readiness.server.ts`
- `migrations/0028_tracking_roles_and_web_mentions.sql`
- `migrations/0035_agent_action_audit.sql`
- `migrations/0036_agent_memory.sql`
- `migrations/0037_client_rooms.sql`
- `migrations/0038_customer_api_key_actions.sql`
- `docs/superpowers/artifacts/2026-04-22-five-to-nine-north-star.md`
- `docs/superpowers/specs/2026-04-18-proof-first-change-alerts-design.md`

External sources checked:

- https://www.foreplay.co/
- https://www.foreplay.co/pricing
- https://www.foreplay.co/api
- https://www.foreplay.co/mcp
- https://magicbrief.com/
- https://www.crayon.co/
- https://klue.com/
- https://klue.com/ai-in-competitive-intelligence-report-2026
- https://www.kompyte.com/
- https://visualping.io/
- https://hexowatch.com/
- https://www.adbeat.com/pricing
- https://www.minea.com/
- https://bigspy.com/en
