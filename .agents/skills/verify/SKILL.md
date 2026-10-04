---
name: verify
description: Start the real 0509 app and drive it with Google's chrome-devtools CLI. Collect a snapshot, a trace, a heap diff or screenshots before you call a change done.
---

# Verify

Drive the running app over the Chrome DevTools protocol and collect proof. The CLI is `chrome-devtools` from `chrome-devtools-mcp@1.9.0`. Page ids are positional (`list_pages` prints `2: https://…`). There is no `--pageId` flag. Uids come from the latest `take_snapshot` and go stale after a navigation.

## Start the app

Start the browser once, then point it at local or production.

```bash
npm run verify:start
npm run verify:stop
```

`verify:start` runs `chrome-devtools start --headless --chromeArg=--no-sandbox` with `--executablePath` set to `node -p "require('playwright-core').chromium.executablePath()"`. `verify:stop` runs `chrome-devtools stop`. `chrome-devtools status` should report version `1.9.0`.

### Local

The port is per process, the same formula as `playwright.config.ts`: `8000 + (pid % 1000)`. Run the block in one shell so the exported port is the port wrangler binds. The local D1 is empty until migrations are applied; without them `/login` throws a schema mismatch instead of rendering.

```bash
npm run build
export PLAYWRIGHT_LOCAL_PORT="${PLAYWRIGHT_LOCAL_PORT:-$((8000 + $$ % 1000))}"
npx wrangler d1 migrations apply 0509 --local </dev/null
npx wrangler dev --env-file .dev.vars.example --local --port "$PLAYWRIGHT_LOCAL_PORT" \
  --var "BETTER_AUTH_URL:http://127.0.0.1:${PLAYWRIGHT_LOCAL_PORT}" --var "DODO_PRODUCT_STARTER:pdt_preview_starter"
```

The two `--var` overrides are the ones `playwright.config.ts` gives its webServer. `BETTER_AUTH_URL` is load-bearing for Sign in below: without it the emailed magic link carries the production origin and the local Worker cannot verify it.

Wait until `curl -fsS "http://127.0.0.1:${PLAYWRIGHT_LOCAL_PORT}/api/health"` returns. Then open the page:

```bash
npx chrome-devtools new_page "http://127.0.0.1:${PLAYWRIGHT_LOCAL_PORT}/login"
npx chrome-devtools list_pages
npx chrome-devtools take_snapshot <pageId>
```

### Production

`/login` on https://0509.io sits behind Cloudflare Access. Read `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` from `~/.config/cloudflare/access-0509-agents.env`. Do not print them. Set the headers on a fresh blank page, then navigate. A throttled production trace lasts long enough for the Access cookie to expire and lands on the Access login page, so take the production trace unthrottled.

```bash
set -a
. ~/.config/cloudflare/access-0509-agents.env
set +a
npx chrome-devtools new_page about:blank
npx chrome-devtools list_pages
npx chrome-devtools emulate <pageId> --extraHttpHeaders "{\"CF-Access-Client-Id\":\"$CF_ACCESS_CLIENT_ID\",\"CF-Access-Client-Secret\":\"$CF_ACCESS_CLIENT_SECRET\"}"
npx chrome-devtools navigate_page <pageId> --url "https://0509.io/login"
npx chrome-devtools take_snapshot <pageId>
```

Do not use `set -x` and do not echo the header JSON. The stock CLI takes those headers only as `--extraHttpHeaders`. A proving run's emulate stdout was exactly `Emulation configured successfully` and contained neither header value. If the output is anything else, stop and do not paste it. The snapshot is the app (heading "Sign in"), not the Access login page.

## Sign in

`/app`, `/onboarding`, Alerts and Settings sit behind sign-in. There is exactly one sign-in path — the form at `/login`, the link the app emails, the session it sets — and the e2e suite drives that same path (`signInWithMagicLink` in `e2e/inbox.ts`) and saves its result to `e2e/.auth/session.json` and the per-lane `e2e/.auth/onboarded-<lane>.json`. This section reuses it: sign in as a fixture account from `app/lib/fixture-accounts.ts` (`FIXTURE_ACCOUNTS`, e.g. `FIXTURE_ACCOUNTS.j7.email` = `e2e+j7@0509.io`), which the suite keeps on purpose (`KEPT_JOURNEY_ACCOUNTS` in `e2e/inbox.ts`). No test-login shortcut, no cookie to mint.

Snapshot the form, fill the email, wait for the Turnstile token, submit. The `evaluate_script` is the Turnstile gate (`settleSignInWidget` in `e2e/inbox.ts`): submitting before the widget has minted its token answers "Confirm you're a person, then we'll send the link." On the local lane a `0` means wait a beat and read it again — that lane has no pre-clearance, so the widget mints the always-pass test token. On production the Access service token pre-clears the captcha server side and a `0` is expected; the gate there is the "CHECK YOUR EMAIL" heading after the click.

```bash
npx chrome-devtools take_snapshot <pageId>
npx chrome-devtools fill <pageId> <emailUid> "e2e+j7@0509.io"
npx chrome-devtools evaluate_script --pageId <pageId> '() => { const f = document.querySelector("input[name=\"cf-turnstile-response\"]"); return f ? f.value.length : 0; }'
npx chrome-devtools click <pageId> <submitUid>
```

Read the link the lane stored it in, then open it in the same page (or a new one). Never paste the verify link into a proof — it is single-use and carries a token.

### Local link

`wrangler dev --local` simulates `send_email`, so the message is the file the local lane of `e2e/inbox.ts` reads: `.wrangler/tmp/email/<session>/email-{text,html}/<id>.txt`. Pick the recipient's newest text part, then take its verify link; the HTML part escapes `&` as `&amp;`.

```bash
MAIL=$(grep -rlF "e2e+j7@0509.io" .wrangler/tmp/email --include='*.txt' | xargs -r ls -t | head -1)
LINK=$(grep -oh "http://127.0.0.1:${PLAYWRIGHT_LOCAL_PORT}/api/auth/magic-link/verify?[^ \"'<>]*" "$MAIL" | sed 's/&amp;/\&/g' | head -1)
npx chrome-devtools navigate_page <pageId> --url "$LINK"
```

### Production link

The real inbox Worker holds the message, gated by `E2E_INBOX_TOKEN` — the endpoint and headers are exactly `readRawMessage` in `e2e/inbox.ts`; the inbox may sit in the same Access application, so send the Access headers too. The message is MIME and both parts are quoted-printable, so join its soft line breaks (`=\n`) and undo `=3D` before taking the `verify?token=` line. `E2E_INBOX_TOKEN` lives in `~/.config/cloudflare/0509-e2e-inbox.env`; do not echo it or the header JSON.

```bash
set -a
. ~/.config/cloudflare/0509-e2e-inbox.env
. ~/.config/cloudflare/access-0509-agents.env
set +a
curl -fsS -H "authorization: Bearer $E2E_INBOX_TOKEN" \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  "https://e2e-inbox.0509.io/message?to=e2e%2Bj7%400509.io" > /tmp/verify-proof/magic-link.txt
LINK=$(sed ':a;N;$!ba;s/=\r\?\n//g' /tmp/verify-proof/magic-link.txt | grep -oh "https://0509.io/api/auth/magic-link/verify?[^ \"'<>]*" | sed -e 's/=3D/=/g' -e 's/&amp;/\&/g' | grep 'token=' | head -1)
npx chrome-devtools navigate_page <pageId> --url "$LINK"
```

An inbox that still holds an earlier message answers with that spent link; sign in again (a new send overwrites the stored message per recipient) and re-read it.

### Landing

A brand-new account lands on `/onboarding`, not `/app`: the workspace has no confirmed brand yet. Finish the one input — `fill` "gymshark.com", `press_key Enter`, and if the card marks the name `CHECK THIS` open `edit name`, `fill` it and `press_key Enter` (the POST rejects an empty name), then `click "That's me"`, `click "Start watching"` — and the app lands on `/app`. The next sign-in as that address goes straight to `/app`, which is the state `e2e/.auth/onboarded-<lane>.json` caches. Take the `/app` snapshot here and paste it as the proof.

### A fresh account

A check that needs a new account (onboarding, an empty workspace) signs up a fresh `e2e+<12 hex>@0509.io` address through the same steps. On production that address is a real row, and the soak report counts every one left behind as a leak (0509#6968: two such rows outlived migration 0044). Before you finish, even when the check failed, delete it through the path `deleteCreatedAccount` in `e2e/inbox.ts` drives: open `/app/settings`, fill the box labelled `Type <address> to confirm` with the address, click `Delete my account`, and confirm the page lands on `/login?deleted=`. A lost session means sign in once more first. Never delete it with SQL. The fixed journey accounts (`e2e+j7@0509.io` and the rest of `KEPT_JOURNEY_ACCOUNTS`) are never deleted.

## Drive it

`take_snapshot <pageId>` lists elements with uids. Act on a uid from that snapshot:

```bash
npx chrome-devtools click <pageId> <uid>
npx chrome-devtools fill <pageId> <uid> "<value>"
npx chrome-devtools press_key <pageId> "<key>"
```

Take a new snapshot after every navigation. The feature map names each control by role and accessible name, so match the snapshot line (for example `textbox "Email"` or `button "Send me a link"`) instead of guessing a uid.

## Proof per change type

Write proof files under `/tmp/verify-proof/` (`mkdir -p /tmp/verify-proof`) so they stay out of the worktree.

### Correctness

Snapshot before and after the action. Then:

```bash
npx chrome-devtools list_console_messages <pageId> --types error
npx chrome-devtools list_network_requests <pageId>
```

Zero console errors. On the app's own origin, no response with status 4xx or 5xx.

### Performance

Local only. Throttle, trace, then read the LCP breakdown:

```bash
npx chrome-devtools emulate <pageId> --cpuThrottlingRate 4 --networkConditions "Slow 4G"
npx chrome-devtools performance_start_trace <pageId> --reload true --autoStop true --filePath /tmp/verify-proof/trace.json.gz
npx chrome-devtools performance_analyze_insight <pageId> NAVIGATION_0 LCPBreakdown
```

The trace summary names LCP, TTFB and render delay. On production, skip the `emulate` throttle and run `performance_start_trace` unthrottled.

### Memory

The daemon starts with memory debugging on. Capture before and after the interactions, then compare:

```bash
npx chrome-devtools take_heapsnapshot <pageId> /tmp/verify-proof/before.heapsnapshot
npx chrome-devtools take_heapsnapshot <pageId> /tmp/verify-proof/after.heapsnapshot
npx chrome-devtools compare_heapsnapshots /tmp/verify-proof/before.heapsnapshot /tmp/verify-proof/after.heapsnapshot
```

The stock CLI command is `take_heapsnapshot`. There is no `take_memory_snapshot`.

### Layout

Screenshots at the same widths as the Playwright projects:

```bash
npx chrome-devtools emulate <pageId> --viewport "1440x900x1"
npx chrome-devtools take_screenshot <pageId> --filePath /tmp/verify-proof/login-1440.png
npx chrome-devtools emulate <pageId> --viewport "390x844x2,mobile,touch"
npx chrome-devtools take_screenshot <pageId> --filePath /tmp/verify-proof/login-390.png
```

## Reproduce a vague user report

Map the words and the screenshot onto feature-map rows. The map is `feature-map.md` beside this skill. Drive those rows with `take_snapshot`, `click`, `fill` and `press_key`. Report the url, the snapshot lines you saw, console errors and failed requests. Quote what the page showed.
