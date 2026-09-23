---
name: verify
description: Run the real 0509 app over the Chrome DevTools protocol and collect proof — snapshots, console and network errors, throttled performance traces with the LCP breakdown, heap diffs and viewport screenshots. Use before opening any PR that touches app/, workers/ or e2e/, when reproducing a vague user report, or when asked to verify a change the way a user would reach it.
---

# Verify — drive the real app, collect proof

The driver is Google's stock `chrome-devtools` CLI, shipped by the
`chrome-devtools-mcp` devDependency pinned at `1.9.0`. We did not write it and
we do not wrap it: every command below is the vendor's own subcommand. The map
of what the app even is lives beside this file in `feature-map.md`.

Run one verification pass per change, against the local build first and against
`https://0509.io` when the change is deploy-shaped.

## Start the app

Local (the same build `preview-assert` runs):

```bash
npm run build
P=$((8000 + $$ % 1000)); npx wrangler dev --local --port "$P"
```

The port derivation is the one `playwright.config.ts` uses
(`8000 + pid % 1000`) so two checkouts on this host never collide. Wait for
`Ready on`, then use `http://127.0.0.1:$P` as the base URL. `wrangler dev
--local` starts with an empty D1 unless you apply the migrations first; for a
session-gated route run `npx wrangler d1 migrations apply 0509 --local
</dev/null` before it, exactly as `playwright.config.ts` does.

Production is `https://0509.io` behind Cloudflare Access. `/` and
`/api/health` are public; everything else needs the agents' service token. The
`lighthouse` job's exchange is the procedure — a token-authenticated request to
`/login` returns `Set-Cookie: CF_Authorization=…`:

```bash
curl -sS -o /dev/null -D - \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  https://0509.io/login | grep -io 'CF_Authorization=[^;]*'
```

Hand that cookie to the CLI either as a header on every request —

```bash
chrome-devtools emulate <pageId> \
  --extraHttpHeaders '{"Cookie":"CF_Authorization=<value>"}'
```

— or inside the page with `evaluate_script "() => { document.cookie =
'CF_Authorization=<value>; path=/'; }"`. Never paste the token itself into an
issue, a PR or a commit.

Start the browser daemon before the first command and stop it after the last:

```bash
npm run verify:start   # chrome-devtools start: headless, --no-sandbox
npm run verify:stop    # chrome-devtools stop
```

`--chromeArg=--no-sandbox` is required on this host; without it the server dies
with `Target closed`. `verify:start` resolves Chromium with
`node -p "require('playwright-core').chromium.executablePath()"`, the same
browser Playwright installed, so there is no second Chromium.

## Drive it

Page ids are positional, assigned in order of creation — they are not a
`--pageId` flag.

```bash
chrome-devtools new_page http://127.0.0.1:8000/login
# prints "1: about:blank", "2: .../login [selected]"
chrome-devtools take_snapshot 2                 # a11y tree, uid=... per control
chrome-devtools click 2 1_6                     # click the element with uid 1_6
chrome-devtools fill 2 1_5 "you@example.com"    # type into a textbox
chrome-devtools press_key 2 Enter               # keyboard path
```

`take_snapshot` is the source of truth: it returns the accessibility tree, so
every control is named by role and accessible name. The feature map's **Reach**
column names the same role and name, which is how you find the control in the
snapshot without guessing a CSS selector. Prefer `click`/`fill` on a uid over
`evaluate_script`; reach for `evaluate_script` only to set a cookie or read a
value the tree does not carry.

## Proof to collect, per change type

**Correctness** — the default for any UI change:

```bash
chrome-devtools take_snapshot 2                 # before
# drive the control
chrome-devtools take_snapshot 2                 # after
chrome-devtools list_console_messages 2         # empty, or only expected ones
chrome-devtools list_network_requests 2         # 2xx/3xx; name any failure
```

**Performance** — for anything on the render path:

```bash
chrome-devtools emulate 2 --cpuThrottlingRate 4 --networkConditions "Slow 4G"
chrome-devtools performance_start_trace 2 --reload true \
  --autoStop true --filePath trace.json.gz
chrome-devtools performance_analyze_insight 2 NAVIGATION_1 LCPBreakdown
```

Use the insight-set id the trace itself printed (`NAVIGATION_0`,
`NAVIGATION_1`, …) and the insight name from its "Available insights" list.
The summary carries LCP and its TTFB / render-delay breakdown and CLS; the
insight carries the same breakdown with the percentages and the estimated
savings. Paste both.

**Memory** — for a list, a stream or an event listener:

```bash
chrome-devtools take_heapsnapshot 2 before.heapsnapshot
# repeat the interaction N times
chrome-devtools take_heapsnapshot 2 after.heapsnapshot
chrome-devtools compare_heapsnapshots before.heapsnapshot after.heapsnapshot
```

The diff's `sizeDelta` must not grow with N; a class that grows by a constant
per interaction is the leak.

**Layout** — for a visual change, at both widths (1440 desktop, 390 phone):

```bash
chrome-devtools emulate 2 --viewport 1440x900x1
chrome-devtools take_screenshot 2 --format png --filePath desktop-1440.png
chrome-devtools emulate 2 --viewport 390x844x1,touch,mobile
chrome-devtools take_screenshot 2 --format png --filePath phone-390.png
```

Every PR that touches `app/` or `workers/` puts the commands it ran and their
pasted output in the `## Verification` section of the PR body, with the head
SHA. Local runs happen before the PR opens; `preview-assert` reruns the e2e
suite on every PR and `e2e-production` and `lighthouse` run after a deploy —
those are CI's job, and none of them replaces driving the app yourself.

## Reproduce a vague user report

A report arrives as a screenshot and three words, and the person is right. The
procedure is:

1. **Read the words and the screenshot into candidate rows.** Open
   `feature-map.md` and match the user's nouns and the screenshot's layout to
   rows — the route, the control by role and accessible name, and the **Does**
   text. If no row matches, stop and say so; a report the map cannot place is a
   gap in the map, not a licence to guess.
2. **Drive the rows you matched.** Build, start the app, snapshot the route,
   and perform the control's Reach path exactly as the row writes it. Do not
   invent a path the row does not name.
3. **Collect the proof for that change type** from the section above — at
   minimum the before/after snapshots, `list_console_messages` and
   `list_network_requests`.
4. **Report what you saw**, not what you expected: the rows matched, the path
   driven, the observed state, and either a failing e2e spec under `e2e/` or a
   no-repro proof that names everything tried. Nothing from the user's raw
   words goes into the PR; a public repository is not a place for a customer's
   message.
