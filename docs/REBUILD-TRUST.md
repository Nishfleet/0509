# REBUILD trust — the product kitchen

Umbrella #3842, Track A. Written by the Opus deputy, **2026-09-21 IST**.

The source is Lauren Tan's *What I learned from reviewing 2,500 agent PRs*
(transcript in the vault at
`00 Inbox/agent-drop/claude/vps/2026-09-21-poteto-2500-prs-talk-transcript.md`;
every timestamp below is hers). Her claim is that trust in agents is produced,
not granted, by three things: **verification the agent can run itself**, **a
correction ladder that lands every fix at the highest rung it fits**, and **a
gardener who kills a pattern before it spreads**. Nish, 2026-09-21: *"lets do
all of the things she mentions."*

Two conventions, the same ones `docs/REBUILD-STACK.md` uses:

- **Probed** = run on this VPS, today, output pasted.
- **Cited** = read in the vendor's docs, URL in the row.

Everything here is stock config. Nothing in this design is a script, a wrapper,
a hook or a bespoke test. Where a stock feature does not reach, the doc says so
rather than filling the gap with glue.

---

## 0. Probe log

Run in `~/workspaces/products/0509` on 2026-09-21:

| Command | Output |
|---|---|
| `npx eslint --version` | `v10.11.0` |
| `npx knip --version` | `6.37.0` |
| `node -p "require('typescript-eslint/package.json').version"` | `8.70.0` |
| `node -p "require('eslint-plugin-react-hooks/package.json').version"` | `7.1.1` |
| `npx playwright --version` | `Version 1.63.0` |
| `ls ~/.cache/ms-playwright` | `chromium-1243  chromium_headless_shell-1243  ffmpeg-1011  firefox-1538` |
| `npm run lint` | `rc=0` |
| `npm run typecheck` | `rc=0` |
| `npm test` | `Test Files 3 passed (3) · Tests 7 passed (7)` |
| `npm run e2e` | `10 passed (4.9s)` — 5 tests × 2 viewports, `wrangler dev` started and torn down by `playwright.config.ts` |

**Deviation from the packet: ESLint 10, not 9.** npm `latest` for `eslint` is
`10.11.0`. Flat config is the only config format in v10, so the packet's
intent — "ESLint 9 flat config" — is satisfied more completely by 10 than by 9,
and pinning to 9 would be starting on a version that is already the previous
major. `typescript-eslint@8.70.0` declares `eslint ^8.57.0 || ^9.0.0 || ^10.0.0`
and installed clean.

**Rejected dependency: `eslint-plugin-react-router`.** `npm view
eslint-plugin-react-router version` returns `0.0.1` — a name placeholder, not a
plugin. `@react-router/eslint-config` is a 404. There is no stock React Router
lint plugin, so the framework's conventions are enforced here by
`no-restricted-syntax` selectors that name the commit they came from, and by the
framework's own generated types, which already make the biggest one a compile
error (ce5fed17d).

---

## A. Verification the agent runs itself

> "the ability for an agent to verify its own work is extremely powerful … it's
> very, very powerful for building that trust" — 12:18

Her verification skill has two halves: a **reproducible way to drive the real
application**, and a **feature map** that tells the agent what the application
even is. We need both. **Decision, 2026-09-22 (#4251):** both halves ship as a
skill — `.agents/skills/verify/SKILL.md`, landed via #4341 — on Nish's word:
*"make it exactly as described."* The driver is Google's stock
`chrome-devtools` CLI from the `chrome-devtools-mcp` package, not code we
wrote, so scripts-to-zero still holds.

**Rejected alternative.** Playwright alone, no skill — this section's original
position. The reasoning: her CLI's shape answered an Electron app with no test
runner that could drive it, ours is a web app whose stock reproducible driver
is Playwright, and a hand-built CLI is exactly the glue the rebuild deletes.
What it missed: the CLI is the vendor's stock binary rather than glue we
wrote, and a skill directory is where the procedure and the feature map live
so every agent session drives the app the same way.

### A1. One Playwright config, two modes

`playwright.config.ts`. The entire switch is one environment variable:

| `PLAYWRIGHT_TEST_BASE_URL` | `webServer` | What runs | Where |
|---|---|---|---|
| unset | starts `npx wrangler dev --local` on a per-process port (8000 + pid % 1000), waits on `/api/health` | the built Worker | `preview-assert`, every PR, and `npm run e2e` on a laptop |
| set | `undefined` | that URL | `e2e-production`, every successful deploy |

This is the vendor's own division. `webServer`'s doc says it is for "when you
don't have a staging or production url to test against"
(<https://playwright.dev/docs/test-webserver>), and `baseURL` falls back to the
built-in `PLAYWRIGHT_TEST_BASE_URL` (<https://playwright.dev/docs/test-configuration>).
`workers: 1` on CI per <https://playwright.dev/docs/ci#workers>. The
`deployment_status` trigger is verbatim from
<https://playwright.dev/docs/ci#on-deployment>; Cloudflare Workers Builds emit
GitHub deployments, so it fires on the real deploy with no polling.

**What this replaced.** `preview-assert` used to be a bash loop:

```
npx wrangler dev --port 8787 --local &
for i in $(seq 1 30); do curl -fsS .../api/health >/tmp/health.json && break; sleep 2; done
grep -q '"status":"ok"' /tmp/health.json
```

That is a hand-rolled server-readiness poller, a hand-rolled retry and a
hand-rolled assertion — three things Playwright ships. The check name
`preview-assert` is byte-identical before and after; only the body changed. The
`main-merge-queue` ruleset (id 21391031, empty bypass) still sees
`Gitleaks`, `codex-node-checks`, `semgrep`, `preview-assert`.

### A2. The smoke suite

`e2e/smoke.spec.ts`, five tests across two viewports (1440 desktop, 390 phone,
the two widths `docs/REBUILD-DONE.md` §A names):

1. the landing page renders its `h1` and its `support@0509.io` link
2. the landing page does not scroll horizontally (§B's mobile gate)
3. `/api/health` returns 200 with `status: "ok"` and a parseable timestamp
4. the login page renders the one input that signs you in
5. the page reaches load with zero console errors (§B's error gate)

**What is deliberately absent: anything needing a row in D1.** `wrangler dev
--local` starts empty and `preview-assert` applies no migrations, so a session
assertion would be testing the empty state rather than the product. The gated
surfaces are J1–J14 and they land with the engines that fill those tables — as
child issues, listed in §E.

### A3. The feature map

`.agents/skills/verify/feature-map.md`. Her framing, 11:02: a Slack report arrives as a vague
screenshot and three question marks, and an agent that can drive the app still
has no idea what the user meant. The map is *materialised memory* — what exists,
how a user reaches it (route, element, keyboard), what it does.

Ours is seeded from `app/routes.ts`, which is the only registry: a route not
listed there cannot be reached. Every row carries its proof (an e2e test or a
journey number), and the file states its own gaps — five of seven signed-in
surfaces are stubs and there is no navigation between them. **A feature map that
omits the gap is how an agent concludes the nav must already exist somewhere it
has not looked.**

Maintenance, per the packet: every PR that adds or changes a route updates
`.agents/skills/verify/feature-map.md` in the same PR, and the Opus reviewer checks it against
`app/routes.ts` and the e2e test titles. **No bespoke test reads this file.**
`docs/REBUILD-DONE.md` §D forbids tests about docs, and a test that greps a
markdown table is the hand-rolled linter Fable already rejected once (ce5fed17d).
The automation half of her version is in §C2: the scout packet regenerates the
map from the two sources and opens a PR when it has drifted.

### A4. Performance, so verification covers more than correctness

> "verification is really about correctness … it doesn't tell you much about the
> performance" — 12:33

**Chosen: `treosh/lighthouse-ci-action@v12`** on the same `deployment_status`
event, with `lighthouse-budget.json`. Already probed in
`docs/REBUILD-STACK.md` §6.3: tag `v12` → `3e7e23fb74242897f95c0ba9cabad3d0227b9b18`,
last push 2026-03-12; `GoogleChrome/lighthouse-ci` ships no action of its own.
The budgets are `docs/REBUILD-DONE.md` §B translated into the vendor's format —
LCP 1500 ms, TTI 3000 ms, CLS 0.1, script 150 KB, total 500 KB.

The load-bearing detail, from §6.3: **the action has no `fail:` input.** It runs
`lhci assert`, reads `assertion-results.json`, and calls `core.setFailed()` only
for assertions at `level: "error"`. Budgets default to error. *A budget written
at warn is green and useless.*

| Rejected | Why |
|---|---|
| Collecting Web Vitals inside the Playwright run (`web-vitals` in an `addInitScript`, thresholds asserted in the spec) | It is a perf-budget script with extra steps: a new runtime dependency, hand-written thresholds, hand-written percentile logic, and a lab measurement taken on a CI runner with no throttling profile. `docs/REBUILD-STACK.md` §6.5 names "a perf-budget script or Lighthouse-score parser" as a thing not to build. Lighthouse's simulated 4G throttling is the thing §B's "on simulated 4G" clause actually refers to. |
| Cloudflare Workers Observability p95 as the gate | It is already on (`wrangler.jsonc` `observability.enabled`) and it is the right tool for *server* time, which is a different number. It cannot see LCP, CLS or bundle size, because those happen in a browser it never meets. Kept as telemetry, not promoted to a gate. |

### A5. Error tracking — the outer loop's input

> "connect [it] to lots of different connectors … Sentry … and use that to make
> really good decisions" — 32:33

The rebuilt app has no error tracking. The two stock candidates, judged
zero-spend-first per Nish's standing no-spend rule:

| Option | Spend | Path from an error to a labelled GitHub issue |
|---|---|---|
| **Cloudflare Workers Logs + Notifications webhook** | $0, already enabled | Notifications post a Cloudflare-shaped JSON body to a URL. GitHub's issue API wants a different body. Closing that gap is an adapter — a Worker, a webhook relay or an Action that reshapes a payload. **That is glue, and it is forbidden.** |
| **`@sentry/cloudflare` + Sentry's native GitHub integration** | $0 on the Developer plan | Sentry's own GitHub integration creates the issue. No payload reshaping, no relay, no code we own between the error and the issue. |

**Chosen: both, with different jobs.** Workers Logs stays on as the *retention
and p95* layer — it is one config line already in `wrangler.jsonc` and it costs
nothing. `@sentry/cloudflare` (10.75.1, probed via `npm view`) becomes the
*trigger*: `withSentry()` wraps the Worker's default export, and a Sentry issue
alert with the GitHub action opens a repo issue on a new error. The fleet's
existing rail picks it up from the label — no new organ, which is the whole
test.

**This is designed here and built by a worker (#issue in §E), not by me**,
because it needs a Sentry organisation created and a `SENTRY_DSN` Worker secret,
and it adds a dependency row to `docs/REBUILD-STACK.md`. Two hard lines go in
that packet: **Developer plan only, never a paid tier or a trial**, and the DSN
is a Worker secret, never a repo file.

---

## B. The correction ladder

> "whenever you find yourself correcting … agent, you really want to think about
> it from these five pieces and where is the most effective step" — 36:08

```
codebase / architecture  >  static analysis  >  rules  >  skills  >  style guide
```

`CLAUDE.md` now opens with this ladder and the instruction that follows from
it: **land the fix at the highest rung possible; a lint rule or a type before a
doc line.** The old `CLAUDE.md` described the *old* app — React Router v7,
Codex-owned Gate-B, `app/lib/delivery.server.ts`, Dodo billing "live", a
Paperclip section, 40 lines of key-file inventory for files that no longer
exist. It was rewritten whole, not patched: a stale rule gets argued with
instead of followed.

### B1. Rung 1, the codebase — what was made impossible

`ce5fed17d` is the model. The fix was not a rule; it was *deleting a
hand-written type annotation* so the framework's generated types could do their
job. After it, this is a compile error:

```
app/routes/app.alerts.tsx(6,16): error TS2339:
Property 'cloudflare' does not exist on type 'Readonly<RouterContextProvider>'
```

Nothing enforces that. It is simply not expressible. **That is what rung 1 buys
and why it is first.**

### B2. Rung 2, static analysis — `eslint.config.js`, and every rule's receipt

`npm run lint` is `eslint . && knip`, and it runs in `codex-node-checks` after
`typecheck` (typed lint rules need the route types that `react-router typegen`
emits).

Base: `@eslint/js` recommended, `typescript-eslint` **strict-type-checked** and
**stylistic-type-checked**, `eslint-plugin-react-hooks` recommended on `app/**`
and `workers/**`, `eslint-plugin-boundaries` 7.2.0 for element dependencies,
and `eslint-plugin-import-x` 4.17.1 for cycles and named exports.

Every boundary rule carries its provenance **in its own message**, so an agent
that trips it reads the reason at the moment it matters:

| Rule | Encodes | Receipt |
|---|---|---|
| `no-restricted-syntax` on `MemberExpression[object.name='context'][property.name='cloudflare']` | bindings come from `cloudflare:workers` | 7727bf787 / #3918 — /api/auth, /app and the magic-link POST all 500'd in production |
| `no-restricted-syntax` on an inline `TSTypeLiteral` in a `loader`/`action`/`meta`/`headers`/`links` parameter | use the framework's `Route` types | ce5fed17d — "a hand-written type annotation over a framework value is an assertion that it is shaped that way" |
| `boundaries/dependencies`: a client file may not import `server-leaf`, `data-writer`, `db`, or `auth` | the server boundary. The old `**/*.server` glob is gone. A later `no-restricted-imports` block replaces an earlier one, so that glob never fired | Dune's renderer/main split, 27:44; the error text is the old glob's receipt |
| `import-x/no-cycle` on `app/**` and `workers/**` | no import cycles | closes the gap §B4 used to record |
| `import-x/no-default-export` | named exports, so a module can be found by grep | off for route modules, config files, and the three workerd entries |
| `no-restricted-imports` `cloudflare:workers` in client modules | same boundary, the other direction | 7727bf787 |
| `no-restricted-imports` `kysely` outside `app/lib/db.server.ts`; `better-auth` and its plugins outside `app/lib/auth.server.ts` | one paved path per blessed pattern | 25:26 |
| `no-restricted-syntax` on DML write text — `INSERT [OR …] INTO`, `REPLACE INTO`, `UPDATE … SET`, `DELETE FROM`, `WITH …` writes — in `app/**` and `workers/**` outside `app/lib/data/**` | one writer per table | 25:26; #4313 — the kysely selectors matched nothing after the raw-D1 rebuild, so the rule fires on the SQL text itself |
| `no-restricted-syntax` on `env.DB` in `app/routes/**` | one data layer | 25:26 |
| `max-lines: 150` on `app/routes/**` | routes stay thin | house rule, `coding-style.md` |
| `no-inline-comments` + `no-warning-comments` on `app/**`, `workers/**` | comments banned in app code | 23:02, Nish 2026-09-21 |

### B3. What the ladder caught on its first run

This is the argument for the rung, so it is recorded rather than summarised.
`npx eslint .` on a repo that had never been linted returned 23 errors. Four
were real:

1. **A live bug.** `const email = String(form.get("email") ?? "")` in
   `app/routes/login.tsx`. `form.get()` returns `string | File`; a request with
   a file part named `email` stringifies to `"[object Object]"` and the magic
   link goes nowhere. Caught by `@typescript-eslint/no-base-to-string`. Fixed to
   a `typeof` narrow.
2. **Three `as never` assertions that were silencing nothing.**
   `createAuth(env as never)` in `require-session.server.ts` and both handlers in
   `api.auth.$.ts`. `no-unnecessary-type-assertion` proved the generated `Env`
   already satisfies `AuthEnv` — the escape hatch was pure superstition,
   inherited from the shape the code had *before* 7727bf787 fixed it. Auto-fixed.
3. **`kysely` was a declared dependency nothing imported**, and `type Auth` an
   export nothing read. Both found by knip, both deleted. The data-layer packet
   re-adds `kysely` when a module actually calls it. (*"delete tech debt that we
   already have"* — 25:19.)
4. **`scheduled` was `async` with nothing to await.**

The first finding is the one that matters. It was in a file two agents had
already reviewed, and no human review would have caught it, because reading
`String(x ?? "")` as suspicious requires knowing `FormData`'s return type by
heart. **That is the difference between rung 2 and rung 5.**

### B4. The one real fork — design-it-twice

**2026-09-22, #4272.** The cycle gap at the bottom of this section is closed.
`eslint-plugin-import-x` 4.17.1 runs `import-x/no-cycle` on `app/**` and
`workers/**`, in the same `npm run lint` pass. `eslint-plugin-boundaries`
7.2.0 declares the element types and which of them may import which. The
hand-written `**/*.server` glob is gone. It was not holding the boundary:
flat config replaces a rule instead of merging it, and the paved-path
`no-restricted-imports` block comes later, so a component that imported
`app/lib/data/workspace.server.ts` was green.

`data-writer`, `component`, `route`, and `worker` are folders, so they are
element types. `db` and `auth` are single files, so they are file categories.
7.2.0 matches an element pattern as a folder. A file category is how it
classifies one file, and one file can carry more than one. `server-leaf` is
the category on every `app/lib/**/*.server.ts`. `db`, `auth`, and
`data-writer` are extra categories on the files the table names.

| Type | Files |
|---|---|
| `route` | `app/routes/**`, `app/root.tsx` |
| `server-leaf` | `app/lib/**/*.server.ts`, including the three rows below |
| `data-writer` | `app/lib/data/**/*.server.ts` |
| `db` | `app/lib/db.server.ts` |
| `auth` | `app/lib/auth.server.ts` |
| `component` | `app/components/**` |
| `worker` | `workers/**` |

A route may import a component or any server element. A server-leaf may
import a server-leaf, a data-writer, `db`, or `auth`. A data-writer may
import a data-writer, `db`, or a server-leaf. `auth` may also import a
worker, because `app/lib/auth.server.ts` imports `workers/delivery/send.ts`.
A worker may import any server element, because `workers/app.ts` imports
`app/lib/liveness-ping.server.ts`. Any file may import a shared client
module such as `app/lib/utils.ts`. A client file that is not a route, a
server module, or an entry may not import a server element. The error text
is the old glob's receipt.

`import-x/no-default-export` is on everywhere except route modules, config
files, and the three workerd entries (`workers/app.ts`,
`workers/fixture-site.ts`, `workers/e2e-inbox.ts`). React Router and those
configs require a default export. workerd requires one on the Worker entry.
Everything else is a named export, so grep can find it.

`kysely`, `better-auth`, and `cloudflare:workers` stay on
`no-restricted-imports`. Those are package names, not element types. The
client block is the later one, and it repeats the paved-path list, because
a later block replaces the rule. `app/lib/auth-client.ts` is the one module
allowed to import `better-auth` client subpaths, so the client block skips
it. A following block still bans `cloudflare:workers` and the exact paved-path
packages there.

**Rejected for this pass, on top of the original fork below.**

- dependency-cruiser. A second tool, and the report shows up in CI rather than on the line. The three reasons under "Chosen: A" still hold. Its cycle check is the piece this section used to say was missing. `import-x/no-cycle` does that inside the lint run we already have.
- Sheriff. It cannot add the broader rules this config already runs: the type-checked bans, the comment ban, `max-lines`.
- Feature-Sliced Design with steiger. That is a full restructure while the rebuild is in progress, with 28 workers writing code at once.

The vault's `design-it-twice` skill applies to exactly one decision here:
**how are module boundaries enforced?** Both candidates are real, shipped tools;
this is a shape choice, not a quality one.

**Candidate A — ESLint `no-restricted-imports` / `no-restricted-syntax`, scoped
per-glob in flat config.** One tool, one config, one gate. Rules live beside the
rest of the lint config, and each carries its own message, so the boundary and
the reason it exists are the same line of text. Reports in the editor, at the
line, which is where an agent reads. Limitation: ESLint sees one file's own
import statements. It cannot say "this component transitively reaches a
`.server` module through three hops."

**Candidate B — `dependency-cruiser`, `forbidden` rules over the real import
graph.** Purpose-built for this: transitive reachability, orphan detection,
cycle detection, a rendered graph. Limitation: a second tool, a second config
file, a second CI step, a second dependency, and a second place a reviewer has
to look to find out why an import is illegal. Its diagnostics arrive as a CI
report, not an editor squiggle.

**Chosen: A. Rejection recorded: dependency-cruiser.** Three reasons, in order.
(1) `npm run lint` already has to exist for the commit-derived rules — B adds a
gate that A gets for free. (2) The message *is* the documentation; splitting
boundaries across two configs splits the provenance too, and a rule whose reason
is lost gets deleted by the next person who trips on it. (3) B's real advantage
— transitive reach — **closes by construction for our one boundary that
matters.** The `.server` ban applies to every client module, so a client module
cannot reach a `.server` module in one hop *or* in three: every hop in the chain
is itself a client module and every one of them is covered. Transitive detection
buys nothing where the direct rule is total.

**Grafted from the loser:** dependency-cruiser's orphan detection is covered
by knip (unused files, unused exports, unused dependencies — it found two on
its first run). Its cycle detection was the gap. That gap is closed by
`import-x/no-cycle`, a stock plugin in the same lint run. The revisit
condition in the original record, a module that is neither a route nor a
`.server` file, is what the element types above are for.

### B5. The comment ban, and exactly how far stock ESLint reaches

> "agents were just using the comments around the code as justification for why
> it wasn't going to solve the actual problem … so in Dune … we made the choice
> to actually ban comments" — 23:37

**The decision, recorded: comments are banned in app code.** Nish, 2026-09-21,
"everything she mentions." Not a style preference — the mechanism is that one
comment justifying one workaround becomes a pattern every later agent copies.

**What stock ESLint actually enforces, stated honestly:**

- `no-inline-comments` — errors on any comment on the same line as code. Not
  deprecated, probed present in 10.11.0.
- `no-warning-comments` with `location: "anywhere"` and the workaround
  vocabulary as terms: `todo`, `fixme`, `xxx`, `hack`, `workaround`,
  `work around`, `for now`, `temporary`, `temporarily`, `not ideal`,
  `should be`, `ideally`, `revisit`, `later`. This is aimed directly at her
  failure mode rather than at comments in general.

**What it does not reach:** a standalone block or line comment above code with
none of those words. There is no core ESLint rule that bans all comments.
`line-comment-position` would close most of the gap and was **rejected**: probed
`deprecated=true` in 10.11.0, and a load-bearing gate built on a deprecated rule
is a gate with an expiry date. A custom rule would close it completely and is
**forbidden** — a hand-written ESLint rule is the hand-rolled linter this repo
has already rejected once (ce5fed17d).

So the ban is: mechanical where stock reaches, reviewer-enforced past that
(§C1), and stated in `CLAUDE.md` as a rule rather than a suggestion. Config
files and tests are exempt — the trap documentation in `wrangler.jsonc` and
`vitest.config.ts` is load-bearing and is not app code.

**Known debt:** `app/**` currently contains explanatory comments written before
this decision, including several that justify a choice rather than describe one.
They are the exact anti-pattern, they are sitting in the files the next agent
will read first, and leaving them while writing a rule against them is how the
virus spreads. Filed as a child issue (§E) rather than done here, because
rewriting product code is a worker's job and the reasons belong in commit
messages, not deleted.

---


**2026-09-22, moved to rung 2 (#4225).** The reviewer half above is gone:
`eslint-plugin-no-comments` (`no-comments/disallowComments`, allow list
`eslint` and `global` only) runs on `app/**` and `workers/**` in the same block
as the other two comment rules. On the day it landed it found 59 comments in
`workers/` that the grader had flagged on #4176 and the merge had kept, which
is the exact hole B5 predicted. Their text is preserved in that PR's commit
message; anything a future reader needs from it belongs in `docs/`, not in the
file.
## C. The gardener

> "every team really needs … a role that I'm calling a gardener … you want to
> nip them in the bud as soon as possible before they start propagating" — 24:26

**No new unit.** No timer, no service, no organ. The gardener is a duty attached
to two things that already exist.

### C1. The Opus review checklist, every worker PR

Three questions, asked of the diff and nothing else:

1. **Does this diff add a workaround?** A retry around a thing that should not
   fail, a fallback that hides a missing case, a cast that silences a type, a
   `catch {}` that swallows.
2. **Does it add a comment that justifies one?** Per §B5 — the comment *is* the
   tell. If removing the comment would make the code look wrong, the code is
   wrong.
3. **Does it add a second way to do something that already has one paved path?**
   A second query builder, a second session read, a second fetch wrapper, a
   second date formatter.

**The verdict is not a review comment.** A "yes" to any of the three means the
PR carries **either the lint rule that makes it impossible, or a filed issue for
that rule**, before it merges. 26:01: *"whenever you see tech debt or bad
patterns, your instinct should be, I need to write a lint rule against it … you
can at least stop the bleeding."* A review comment that only asks for a change
teaches one agent once; a rule teaches every agent forever.

Implemented in the `opus-review` job's `prompt:` (`.github/workflows/ci.yml`) by
PR #4255, which asks all three questions above word for word and states the
verdict rule in its grade-capping form. The same prompt also asks a fourth
question (Nish 2026-09-22): for a PR touching `app/` or `workers/`, the body
must carry a `## Verification` section showing a real run of the verify skill
(`.agents/skills/verify/`) at the PR head — commands, pasted output and the
head SHA — and a missing or prose-only section fails the review.

Reviewers also check the two things no test checks: that
`.agents/skills/verify/feature-map.md` matches `app/routes.ts` after a route change, and that
every new dependency has a row in `docs/REBUILD-STACK.md`.

### C2. The scout packet's gardener section

`pi-scout@0509.timer` is disabled pending C4b (#3918). **When it is
re-enabled, its packet gains this block verbatim.** It is written now so that
re-enabling is a config change and not a design session.

> ### GARDENER SWEEP — run this every scout pass, before anything else
>
> You are the gardener. Your job is not to add features; it is to find what has
> crept in and stop it spreading. Work only from command output, never from
> memory of the codebase.
>
> **1. Dead growth.** Run `npx knip`. Every unused file, export and dependency
> it reports is a finding. Do not add it to `ignoreDependencies` unless you can
> state, in the config, the vendor behaviour that makes it a false positive —
> the two entries already there each name theirs.
>
> **2. Warnings that are becoming rules.** Run `npx eslint . --max-warnings 0`.
> Anything above zero is a finding. A warning that survives two sweeps is a
> rule that has not been written yet.
>
> **3. Duplicate-pattern hunt.** Pick the paved paths from `CLAUDE.md` and check
> each for a second implementation:
> - who imports `kysely` other than `app/lib/db.server.ts`
> - who calls `betterAuth(` other than `app/lib/auth.server.ts`
> - how many distinct date/number formatters exist under `app/`
> - how many `fetch(` call sites are not behind a named module
> - any `catch {}` or `catch (e) {}` with an empty body
> - any `as any`, `as never`, `@ts-expect-error` or `eslint-disable` added since
>   the last sweep (`git log -S` is the tool; count, do not eyeball)
>
> Two implementations of one thing is a finding even when both are correct.
> Agents extend whichever one they read first, so a second path is a coin flip
> that compounds.
>
> **4. Feature-map drift.** Read `app/routes.ts` and the test titles in
> `e2e/`. Compare against `.agents/skills/verify/feature-map.md`: a route with no row, a row with
> no route, a row whose Proof column names a test that no longer exists, a row
> describing behaviour the route no longer has. **If it has drifted, regenerate
> the affected rows from those two sources by hand and open a PR with only that
> change.** By hand, in the editor — there is no generator and writing one is
> forbidden. The map is short on purpose so that this stays a five-minute job.
>
> **5. File a lint-rule issue per finding — one issue each, not a digest.**
> Title it as the rule, not the instance: "lint: forbid X" beats "clean up Y in
> Z". Body: the rule, the config entry to add, the commit or issue that
> motivates it, and every current violation with its path. Label `agent-ready`
> when the rule is writable today; `agent-blocked` with `blocked-on:` when it
> depends on a refactor that has not landed.
>
> **A sweep that finds nothing reports "nothing found" with the four command
> outputs pasted.** A silent sweep is indistinguishable from a sweep that did
> not run.

---

## D. Dune-equivalent conventions

Her Dune is an Electron client framework; the transferable part is not its
shape but its principle (29:22: *"it's not about Dune, but the idea that an
agent-friendly framework of your own is actually very, very powerful"*). Ours is
a React Router 8 app on one Worker, and the equivalent conventions are these —
**every one enforced by lint or by types, none by prose alone**:

| Dune convention | Ours | Enforced by |
|---|---|---|
| Features co-located in one folder | A feature is its route module plus its `app/lib/<feature>*.server.ts` leaf plus its `app/lib/data/<table>.server.ts` writer — not split by file type | `max-lines` on routes pushes logic to the leaf; the paved-path import rules keep it from going anywhere else |
| Main process vs renderer thread | `*.server` modules vs client modules | `boundaries/dependencies` |
| One blessed way per pattern | one data layer (`app/lib/db.server.ts`), one session authority (`app/lib/auth.server.ts`) | `no-restricted-imports` on `kysely`, `better-auth` and its plugins |
| Thin entry points | routes are 150 lines and do not query | `max-lines`, plus `no-restricted-syntax` on `env.DB` in routes |
| — | one writer per table | `no-restricted-syntax` on DML statement text in `app/**` + `workers/**` outside `app/lib/data/**` |
| Comments banned | comments banned in app code | `no-inline-comments`, `no-warning-comments`, §B5 |

Two of these name files that do not exist yet — `app/lib/db.server.ts` and
`app/lib/data/`. That is deliberate. **The rule is written before the first
module, so the first module lands on the paved path instead of paving a second
one.** A rule added after the fact has to fight an existing pattern; a rule added
before has nothing to fight.

---

## E. What is left for workers

Child issues under #3842. Numbers and labels are in the PR description and the
umbrella.

- **The comment sweep** (`agent-ready`) — strip comments from `app/**`, moving
  anything load-bearing into the commit message or `.agents/skills/verify/feature-map.md`. §B5.
- **Error tracking** (`agent-ready`) — `@sentry/cloudflare`, Developer plan,
  `SENTRY_DSN` as a Worker secret, Sentry→GitHub issue alert, dependency row in
  `docs/REBUILD-STACK.md`. §A5.
- **J1–J14** (`agent-blocked`, `blocked-on:` the engine that fills the tables) —
  the journeys in `docs/REBUILD-DONE.md` §A become e2e specs as they become
  buildable. J1 and J2 (magic link, passkey) unblock first: they need only the
  auth tables, which `migrations/0001_rebuild.sql` already creates.

---

## F. What needs Nish

- **A Sentry organisation on the Developer plan.** Zero spend, so account
  creation is inside standing authorization and the worker does it — but the
  *first* paid-tier prompt is a hard stop, and Nish should know the account
  exists in his name before it starts receiving production stack traces.

Nothing else. No money, no security action, and no taste call this doc could not
settle from the talk.
