# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journey-1-release.spec.ts >> Gate-B Journey 1: first visit to value to signup (mobile)
- Location: e2e/journey-1-release.spec.ts:177:3

# Error details

```
Error: brand wordmark should meet readable contrast

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 4.5
Received:    2.2346093261313937
```

# Page snapshot

```yaml
- main [ref=f2e2]:
  - generic [ref=f2e3]:
    - link "Five to Nine home" [ref=f2e4] [cursor=pointer]:
      - /url: /
      - generic [ref=f2e5]:
        - generic [aria-hidden] [ref=f2e6]: fivetonine
        - text: Five to NineCompetitor change monitoring
    - navigation "Primary" [ref=f2e7]:
      - link "Search preview" [ref=f2e8] [cursor=pointer]:
        - /url: /search
      - link "Compare" [ref=f2e9] [cursor=pointer]:
        - /url: /compare
      - link "Pricing" [ref=f2e10] [cursor=pointer]:
        - /url: /pricing
      - link "Help" [ref=f2e11] [cursor=pointer]:
        - /url: /help
      - link "Docs" [ref=f2e12] [cursor=pointer]:
        - /url: /docs
      - link "Status" [ref=f2e13] [cursor=pointer]:
        - /url: /status
    - navigation "Account" [ref=f2e14]:
      - link "Sign in" [ref=f2e15] [cursor=pointer]:
        - /url: /auth/login
      - link "Sign up" [ref=f2e16] [cursor=pointer]:
        - /url: /auth/signup
  - article [ref=f2e18]:
    - text: Docs
    - heading "Five to Nine docs." [level=1] [ref=f2e19]
    - paragraph [ref=f2e20]: Task-focused guidance for finding one competitor, judging the proof, saving the work, and knowing what your plan actually includes. Live service health is measured continuously on the Status page.
    - navigation "On this page" [ref=f2e21]:
      - text: On this page
      - list [ref=f2e22]:
        - listitem [ref=f2e23]:
          - link "Run a trustworthy first search" [ref=f2e24] [cursor=pointer]:
            - /url: "#first-search"
        - listitem [ref=f2e25]:
          - link "Understand the proof labels" [ref=f2e26] [cursor=pointer]:
            - /url: "#proof-labels"
        - listitem [ref=f2e27]:
          - link "Troubleshoot empty or partial results" [ref=f2e28] [cursor=pointer]:
            - /url: "#troubleshoot"
        - listitem [ref=f2e29]:
          - link "Plan boundaries" [ref=f2e30] [cursor=pointer]:
            - /url: "#plan-boundaries"
        - listitem [ref=f2e31]:
          - link "Use Five to Nine from AI agents" [ref=f2e32] [cursor=pointer]:
            - /url: "#ai-agents"
        - listitem [ref=f2e33]:
          - link "Coverage and trust boundaries" [ref=f2e34] [cursor=pointer]:
            - /url: "#coverage-trust"
        - listitem [ref=f2e35]:
          - link "Key docs" [ref=f2e36] [cursor=pointer]:
            - /url: "#key-docs"
    - generic [ref=f2e37]:
      - heading "Run a trustworthy first search" [level=2] [ref=f2e38]
      - list [ref=f2e39]:
        - listitem [ref=f2e40]:
          - text: Open
          - link "the Nykaa search example" [ref=f2e41] [cursor=pointer]:
            - /url: /search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com
          - text: or paste a competitor website into Search. Provider availability can vary.
        - listitem [ref=f2e42]: Check the source, verification label, and freshness before relying on a result.
        - listitem [ref=f2e43]: Use broader matches only as candidates. They are not proof that an ad belongs to the website.
        - listitem [ref=f2e44]: Create an account only when the evidence is useful enough to retain as a watchlist.
    - generic [ref=f2e45]:
      - heading "Understand the proof labels" [level=2] [ref=f2e46]
      - generic [ref=f2e47]:
        - generic [ref=f2e48]:
          - term [ref=f2e49]: Verified
          - definition [ref=f2e50]: The result is linked to the requested competitor by the active search pipeline.
        - generic [ref=f2e51]:
          - term [ref=f2e52]: Likely
          - definition [ref=f2e53]: The advertiser name fits this brand, but no website link was captured — confirm the match before treating it as proof.
        - generic [ref=f2e54]:
          - term [ref=f2e55]: Unmatched
          - definition [ref=f2e56]: Returned by the source, but nothing connects this ad to the searched website.
        - generic [ref=f2e57]:
          - term [ref=f2e58]: Sample
          - definition [ref=f2e59]: Static product walkthrough data, always labeled sample-only and never presented as a live result.
    - generic [ref=f2e60]:
      - heading "Troubleshoot empty or partial results" [level=2] [ref=f2e61]
      - paragraph [ref=f2e62]:
        - text: No evidence is not proof that a competitor has no active ads. Coverage can be partial, delayed, or cached. The freshness line on a result, like "Fresh live result", "Recent cached result", or "Older cached result", tells you when the evidence was captured; read it before treating a cached result as current. Try the brand name with the website, review broader candidates manually, and check
        - link "Status" [ref=f2e63] [cursor=pointer]:
          - /url: /status
        - text: for live measured service health. If a known active campaign still does not appear, open
        - link "Help" [ref=f2e64] [cursor=pointer]:
          - /url: /help
        - text: instead of treating the empty state as a market conclusion.
    - generic [ref=f2e65]:
      - heading "Plan boundaries" [level=2] [ref=f2e66]
      - paragraph [ref=f2e67]: These are documented plan entitlements, not a live availability guarantee; account and provider readiness still apply.
      - list [ref=f2e68]:
        - listitem [ref=f2e69]: "Free plan scope: one competitor with an instant first scan (the activation scan) and one first brief, Meta Ad Library only. No recurring checks or briefs, no Collections, no instant alerts, manual refresh, or exports — scheduled checks and recurring briefs are paid, and paid plans add 3–6 hour checks and more competitors. Never asks for a card."
        - listitem [ref=f2e70]: "Scout plan scope: three scheduled watchlists, a six-hour cadence, weekly email briefs, ten collections, and 50 included evidence checks each month."
        - listitem [ref=f2e71]: "Starter plan scope: daily briefs, urgent alerts, evidence capture, and exports, with ten watchlists on a three-hour cadence."
        - listitem [ref=f2e72]: "Agency plan scope: client reports, share links, PDF delivery, branding, full API/MCP agent actions, and team seats."
        - listitem [ref=f2e73]: Locked actions should appear locked before click; server-side plan checks still apply.
    - generic [ref=f2e74]:
      - heading "Use Five to Nine from Claude, ChatGPT, and AI agents" [level=2] [ref=f2e75]
      - paragraph [ref=f2e76]:
        - text: Five to Nine speaks MCP (Model Context Protocol), so compatible assistants and agents can read your saved competitive evidence and run approved workspace actions. Connect a client to the endpoint with a customer API key from
        - link "Developer access" [ref=f2e77] [cursor=pointer]:
          - /url: /auth/login?redirectTo=%2Fapp%2Fdeveloper-access
        - text: "as the bearer token:"
      - code [ref=f2e79]: "https://0509.io/api/mcp Authorization: Bearer f9_live_..."
      - paragraph [ref=f2e80]: "Example prompts once connected:"
      - list [ref=f2e81]:
        - listitem [ref=f2e82]: “Check my Five to Nine watchlists and summarize which competitors changed their offers or landing pages this week.”
        - listitem [ref=f2e83]: “Export my ‘Skincare rivals’ collection from Five to Nine as JSON and draft a counter-move brief from the three longest-running ads.”
      - paragraph [ref=f2e84]:
        - text: "Honest boundary: read-only API and MCP access are available on Scout; write scopes and exports require Starter or above, and full agent actions require Agency. Read-only keys cover readiness and saved evidence; write-enabled keys unlock only the documented approved actions — see"
        - link "API docs" [ref=f2e85] [cursor=pointer]:
          - /url: /api/docs
        - text: for endpoints and limits. The
        - link "one-paste MCP setup" [ref=f2e86] [cursor=pointer]:
          - /url: /mcp/setup
        - text: has ready-made snippets for Claude Desktop, ChatGPT, and pi.
    - generic [ref=f2e87]:
      - heading "Coverage and trust boundaries" [level=2] [ref=f2e88]
      - list [ref=f2e89]:
        - listitem [ref=f2e90]: Do not infer spend, reach, impressions, ROAS, or a winning creative from public evidence.
        - listitem [ref=f2e91]: Broad unsupported-channel monitoring and automatic client sends are not offered.
        - listitem [ref=f2e92]: Social connectors and their delivery claims stay gated until the signed-in product explicitly marks them ready.
        - listitem [ref=f2e93]: Five to Nine does not claim SOC 2, HIPAA, GDPR compliance, zero retention, or no-training guarantees.
    - generic [ref=f2e94]:
      - heading "Key docs" [level=2] [ref=f2e95]
      - generic [ref=f2e96]:
        - link "Help" [ref=f2e97] [cursor=pointer]:
          - /url: /help
        - 'link "Guide: how to track competitor ads" [ref=f2e98] [cursor=pointer]':
          - /url: /guides/how-to-track-competitor-ads
        - 'link "Guide: how to monitor a competitor''s Meta Ad Library" [ref=f2e99] [cursor=pointer]':
          - /url: /guides/how-to-monitor-meta-ad-library
        - 'link "Guide: how to monitor a competitor''s landing page changes" [ref=f2e100] [cursor=pointer]':
          - /url: /guides/how-to-monitor-competitor-landing-page-changes
        - 'link "Guide: how to get alerted when a competitor changes their offer" [ref=f2e101] [cursor=pointer]':
          - /url: /guides/how-to-get-alerted-when-a-competitor-changes-their-offer
        - 'link "Guide: how to prove what changed on a competitor''s website" [ref=f2e102] [cursor=pointer]':
          - /url: /guides/how-to-prove-what-changed-on-a-competitor-website
        - 'link "Guide: how to turn a one-off check into a standing watch" [ref=f2e103] [cursor=pointer]':
          - /url: /guides/how-to-turn-a-one-off-competitor-check-into-a-standing-watch
        - 'link "Guide: Meta Ad Library API limitations" [ref=f2e104] [cursor=pointer]':
          - /url: /guides/meta-ad-library-api-limitations
        - link "API docs" [ref=f2e105] [cursor=pointer]:
          - /url: /api/docs
        - link "MCP setup" [ref=f2e106] [cursor=pointer]:
          - /url: /mcp/setup
        - link "Status" [ref=f2e107] [cursor=pointer]:
          - /url: /status
        - link "Changelog" [ref=f2e108] [cursor=pointer]:
          - /url: /changelog
        - link "Trust and security" [ref=f2e109] [cursor=pointer]:
          - /url: /trust
        - link "Privacy" [ref=f2e110] [cursor=pointer]:
          - /url: /privacy
  - navigation "Public footer" [ref=f2e112]:
    - link "Help" [ref=f2e113] [cursor=pointer]:
      - /url: /help
    - link "Docs" [ref=f2e114] [cursor=pointer]:
      - /url: /docs
    - link "API docs" [ref=f2e115] [cursor=pointer]:
      - /url: /api/docs
    - link "Status" [ref=f2e116] [cursor=pointer]:
      - /url: /status
    - link "Changelog" [ref=f2e117] [cursor=pointer]:
      - /url: /changelog
    - link "Proof rules" [ref=f2e118] [cursor=pointer]:
      - /url: /capture-rules
    - link "Trust" [ref=f2e119] [cursor=pointer]:
      - /url: /trust
    - link "Privacy" [ref=f2e120] [cursor=pointer]:
      - /url: /privacy
    - link "Terms" [ref=f2e121] [cursor=pointer]:
      - /url: /terms
    - link "support@0509.io" [ref=f2e122] [cursor=pointer]:
      - /url: mailto:support@0509.io
```

# Test source

```ts
  50  |   const viewport = page.viewportSize();
  51  |   const requireTouchTargets = Boolean(viewport && viewport.width <= 900);
  52  |   for (const label of ["Search preview", "Compare", "Pricing", "Help", "Docs", "Status"] as const) {
  53  |     const link = navigation.getByRole("link", { name: label, exact: true });
  54  |     await expect(link).toBeVisible();
  55  |     await expect(link).toHaveAttribute("href", /\S+/u);
  56  |     if (requireTouchTargets) await expectMinimumTouchTarget(link);
  57  |     await expectVisibleKeyboardFocus(link);
  58  |   }
  59  | }
  60  | 
  61  | const publicTruthSurfaces = [
  62  |   {
  63  |     state: "docs" as const,
  64  |     path: "/docs",
  65  |     heading: "Five to Nine docs.",
  66  |     truth: [
  67  |       "Live service health is measured continuously on the Status page.",
  68  |       "Provider availability can vary.",
  69  |     ],
  70  |   },
  71  |   {
  72  |     state: "status" as const,
  73  |     path: "/status",
  74  |     heading: "Five to Nine service status.",
  75  |     truth: [
  76  |       "Five to Nine measures public search, sign-in, billing, email delivery, scheduled monitoring, and uptime on this page",
  77  |       "every number below is read from the service's own probe records each time you load it",
  78  |     ],
  79  |   },
  80  |   {
  81  |     state: "help" as const,
  82  |     path: "/help",
  83  |     heading: "Get Five to Nine working for your team.",
  84  |     truth: [
  85  |       "the last digest and email accepted by the provider, plus the bounce and complaint suppression count",
  86  |       "Free lets you watch one competitor",
  87  |     ],
  88  |   },
  89  |   {
  90  |     state: "trust" as const,
  91  |     path: "/trust",
  92  |     heading: "Trust and security basics.",
  93  |     truth: [
  94  |       "This is the current lightweight trust surface. It does not make compliance claims that have not been verified.",
  95  |       "the Status page measures email delivery, scheduled monitoring, and uptime live.",
  96  |     ],
  97  |   },
  98  |   {
  99  |     state: "privacy" as const,
  100 |     path: "/privacy",
  101 |     heading: "Five to Nine privacy basics.",
  102 |     truth: [
  103 |       "This is a plain-English summary of the current product behavior.",
  104 |       "Tracking status stays visible when results are recent, delayed, or freshly verified.",
  105 |     ],
  106 |   },
  107 |   {
  108 |     state: "terms" as const,
  109 |     path: "/terms",
  110 |     heading: "Five to Nine terms.",
  111 |     truth: [
  112 |       "These plain-English operating terms cover accounts using Five to Nine.",
  113 |       "Recent results, delayed checks, and fresh checks are labeled honestly wherever they appear.",
  114 |     ],
  115 |   },
  116 | ] as const;
  117 | 
  118 | async function expectReadableBrandContrast(page: Page): Promise<void> {
  119 |   const brand = page.locator(".f9-legal-nav .f9-brandmark .f9-wordmark").first();
  120 |   const contrast = await brand.evaluate((element) => {
  121 |     const nav = element.closest<HTMLElement>(".f9-legal-nav");
  122 |     const parseRgb = (value: string): [number, number, number] | null => {
  123 |       const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/u);
  124 |       return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  125 |     };
  126 |     const luminance = ([red, green, blue]: [number, number, number]) =>
  127 |       [red, green, blue]
  128 |         .map((channel) => channel / 255)
  129 |         .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  130 |         .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  131 |     const ratio = (foreground: [number, number, number] | null, background: [number, number, number] | null) => {
  132 |       if (!foreground || !background) return null;
  133 |       const foregroundLuminance = luminance(foreground);
  134 |       const backgroundLuminance = luminance(background);
  135 |       return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
  136 |         (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  137 |     };
  138 |     const navBackground = nav ? parseRgb(getComputedStyle(nav).backgroundColor) : null;
  139 |     const baseRatio = ratio(parseRgb(getComputedStyle(element).color), navBackground);
  140 |     const bridge = element.querySelector<HTMLElement>(".f9-wordmark-bridge");
  141 |     const bridgeRatio = bridge
  142 |       ? ratio(parseRgb(getComputedStyle(bridge).color), parseRgb(getComputedStyle(bridge).backgroundColor))
  143 |       : null;
  144 |     if (baseRatio === null || bridgeRatio === null) return null;
  145 |     return Math.min(baseRatio, bridgeRatio);
  146 |   });
  147 | 
  148 |   expect(contrast, "brand wordmark contrast should be measurable").not.toBeNull();
  149 |   if (contrast !== null) {
> 150 |     expect(contrast, "brand wordmark should meet readable contrast").toBeGreaterThanOrEqual(4.5);
      |                                                                      ^ Error: brand wordmark should meet readable contrast
  151 |   }
  152 | }
  153 | 
  154 | async function expectPublicTruthSurface(
  155 |   page: Page,
  156 |   testInfo: Parameters<typeof attachReleaseStateArtifacts>[0]["testInfo"],
  157 |   surface: (typeof publicTruthSurfaces)[number],
  158 | ) {
  159 |   await page.goto(surface.path);
  160 |   await expect(page).toHaveURL(new RegExp(`${surface.path.replace("/", "\\/")}$`, "u"));
  161 |   await expect(page.getByRole("heading", { name: surface.heading, exact: true })).toBeVisible();
  162 |   for (const truth of surface.truth) {
  163 |     await expect(page.getByText(truth, { exact: false })).toBeVisible();
  164 |   }
  165 |   await expectReadableBrandContrast(page);
  166 |   await expectVisibleKeyboardFocus(page.locator(".f9-legal-nav .f9-brandmark").first());
  167 |   await expectPhoneTouchTargets(page);
  168 |   await expectNoHorizontalOverflow(page);
  169 |   await attachReleaseStateArtifacts({ page, testInfo, prefix: "j1", state: surface.state });
  170 | }
  171 | 
  172 | for (const viewport of viewports) {
  173 |   // Shared-resource lock (issue #1727): the journey signs up personas and
  174 |   // writes the shared local fixture D1, and the same spec runs under five
  175 |   // engine projects — without the lock two engines can mutate the same
  176 |   // persona state concurrently.
  177 |   test(`Gate-B Journey 1: first visit to value to signup (${viewport.name})`, { lock: "d1" }, async ({ page }, testInfo) => {
  178 |     await page.setViewportSize(viewport);
  179 |     expect(page.viewportSize()).toEqual({ width: viewport.width, height: viewport.height });
  180 |     await page.setExtraHTTPHeaders({
  181 |       "x-0509-e2e-test-mode": "1",
  182 |       "x-0509-e2e-search-rollout": "v2",
  183 |     });
  184 |     test.info().annotations.push(
  185 |       { type: "persona", description: "anonymous" },
  186 |       { type: "viewport", description: `${viewport.width}x${viewport.height}` },
  187 |       { type: "scenario", description: "first visit → value → signup" },
  188 |     );
  189 | 
  190 |     // First visit: establish the product promise without an account.
  191 |     await page.goto("/");
  192 |     await expect(page.getByRole("heading", { level: 1, name: /See the Meta ads.*any competitor is.*running.*right now/i })).toBeVisible();
  193 |     await expect(page.getByText("No account needed.", { exact: true })).toBeVisible();
  194 |     // The "Try with <brand>" CTA shows the geo featured brand the homepage
  195 |     // renders (issue #2281: nike.com for US/EU/unknown, nykaa.com for India).
  196 |     // Match the link the homepage actually renders instead of hardcoding a
  197 |     // brand, so the test follows the geo selection rather than fixing one.
  198 |     const trialLink = page.getByRole("link", { name: /^Try with \S+/ });
  199 |     await expect(trialLink).toBeVisible();
  200 |     const trialHref = await trialLink.getAttribute("href");
  201 |     expect(trialHref, "Try-with CTA must link to a /search preview").toMatch(/^\/search\?/);
  202 |     const trialHrefUrl = new URL(`http://localhost${trialHref}`);
  203 |     expect(trialHrefUrl.pathname).toBe("/search");
  204 |     expect(trialHrefUrl.searchParams.get("mode")).toBe("advertiser");
  205 |     expect(trialHrefUrl.searchParams.get("website")).toMatch(/^https:\/\/[^\s]+$/);
  206 |     expect(trialHrefUrl.searchParams.get("query")).toBeTruthy();
  207 |     await trialLink.click();
  208 |     await expect(page).toHaveURL(/\/search\?.*mode=advertiser/);
  209 |     const trialUrl = new URL(page.url());
  210 |     expect(trialUrl.searchParams.get("mode")).toBe("advertiser");
  211 |     expect(trialUrl.searchParams.get("website")).toBe(trialHrefUrl.searchParams.get("website"));
  212 |     expect(trialUrl.searchParams.get("query")).toBe(trialHrefUrl.searchParams.get("query"));
  213 |     await page.goto("/");
  214 |     for (const surface of publicTruthSurfaces) {
  215 |       await expectPublicTruthSurface(page, testInfo, surface);
  216 |     }
  217 |     await page.goto("/");
  218 |     await expectNoHorizontalOverflow(page);
  219 | 
  220 |     await expectMarketingPrimaryNavigation(page);
  221 |     const homeWebsite = page.getByLabel("Competitor website").first();
  222 |     const homeSubmit = page.getByRole("button", { name: /Preview available ads/i });
  223 |     await expectPrimaryActionAboveFold(homeWebsite, "homepage live-search field");
  224 |     await expectPrimaryActionAboveFold(homeSubmit, "homepage live-search action");
  225 |     await expectMinimumTouchTarget(homeWebsite);
  226 |     await expectMinimumTouchTarget(homeSubmit);
  227 |     await expectFocusTransition(homeWebsite, homeSubmit);
  228 |     await expectFocusTransition(homeSubmit, trialLink);
  229 |     await expectFocusTransition(
  230 |       trialLink,
  231 |       page.getByRole("link", { name: "Review the proof brief" }),
  232 |     );
  233 |     await expectVisibleKeyboardFocus(homeWebsite);
  234 |     await expectPhoneTouchTargets(page);
  235 |     await expectReducedMotionSafe(page, page.locator(".ld-hero"));
  236 |     await attachReleaseStateArtifacts({ page, testInfo, prefix: "j1", state: "home" });
  237 | 
  238 |     // Failure/empty state: the form accepts focus and explains a malformed domain.
  239 |     await homeWebsite.fill("not-a-domain");
  240 |     await page.keyboard.press("Enter");
  241 |     await expect(page).toHaveURL(/\/search\?website=not-a-domain/);
  242 |     await expect(page.getByRole("heading", { name: "Find competitor ads" })).toBeVisible();
  243 |     await expectPublicSearchNavigation(page);
  244 |     const inputAlert = page.getByRole("alert");
  245 |     await expectStatusAnnouncement(
  246 |       inputAlert,
  247 |       "That website looks incomplete. Add the full domain, like brand.com.",
  248 |       "alert",
  249 |     );
  250 |     await expect(page.getByLabel("Competitor website").first()).toHaveAttribute("aria-invalid", "true");
```