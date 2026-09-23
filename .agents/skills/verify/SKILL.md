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
npx wrangler dev --local --port "$PLAYWRIGHT_LOCAL_PORT"
```

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

Map the words and the screenshot onto feature-map rows. The map is `docs/FEATURE-MAP.md` until #4332 moves it to `feature-map.md` beside this skill. Drive those rows with `take_snapshot`, `click`, `fill` and `press_key`. Report the url, the snapshot lines you saw, console errors and failed requests. Quote what the page showed.
