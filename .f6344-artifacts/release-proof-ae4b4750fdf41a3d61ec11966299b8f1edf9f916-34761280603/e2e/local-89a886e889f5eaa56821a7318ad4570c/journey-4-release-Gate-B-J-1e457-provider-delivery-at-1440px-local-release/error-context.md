# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journey-4-release.spec.ts >> Gate-B Journey 4 — evidence, reports, sharing, export, and client delivery >> exports and share controls expose plan truth before click and do not claim provider delivery at 1440px
- Location: e2e/journey-4-release.spec.ts:378:5

# Error details

```
Error: interactive controls should retain a 44px touch target

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 22

- Array []
+ Array [
+   Object {
+     "height": 21,
+     "text": "Search…⌘K",
+     "width": 93.453125,
+   },
+   Object {
+     "height": 21,
+     "text": "Sign out",
+     "width": 64.921875,
+   },
+   Object {
+     "height": 21,
+     "text": "Sign out",
+     "width": 64.921875,
+   },
+   Object {
+     "height": 17,
+     "text": "Upgrade to Agency",
+     "width": 124.40625,
+   },
+ ]
```

# Page snapshot

```yaml
- main [ref=f4e2]:
  - link "Skip to content" [ref=f4e3] [cursor=pointer]:
    - /url: "#f9-main-content"
  - generic [ref=f4e4]:
    - complementary "Application" [ref=f4e5]:
      - link "Five to Nine" [ref=f4e7] [cursor=pointer]:
        - /url: /app
      - button "Search…" [ref=f4e8]: Search…⌘K
      - navigation "Workspace" [ref=f4e11]:
        - link "Competitors" [ref=f4e12] [cursor=pointer]:
          - /url: /app
        - link "Briefs" [ref=f4e13] [cursor=pointer]:
          - /url: /app/briefs
        - link "Account & Billing" [ref=f4e14] [cursor=pointer]:
          - /url: /app/account
        - link "Team" [ref=f4e15] [cursor=pointer]:
          - /url: /app/team
        - link "API" [ref=f4e16] [cursor=pointer]:
          - /url: /app/api
        - link "Settings" [ref=f4e17] [cursor=pointer]:
          - /url: /app/settings
        - link "Help" [ref=f4e18] [cursor=pointer]:
          - /url: /app/help
      - generic [ref=f4e19]:
        - generic [ref=f4e20]:
          - text: E
          - generic [ref=f4e21]: E2E Agencye2e-agency@example.invalid
        - button "Sign out" [ref=f4e24]
    - navigation "Workspace sections" [ref=f4e25]:
      - link "Competitors" [ref=f4e26] [cursor=pointer]:
        - /url: /app
      - link "Briefs" [ref=f4e27] [cursor=pointer]:
        - /url: /app/briefs
      - link "Account & Billing" [ref=f4e28] [cursor=pointer]:
        - /url: /app/account
      - link "Team" [ref=f4e29] [cursor=pointer]:
        - /url: /app/team
      - link "API" [ref=f4e30] [cursor=pointer]:
        - /url: /app/api
      - link "Settings" [ref=f4e31] [cursor=pointer]:
        - /url: /app/settings
      - link "Help" [ref=f4e32] [cursor=pointer]:
        - /url: /app/help
      - button "Sign out" [ref=f4e34]
    - status
    - generic [ref=f4e37]:
      - generic [ref=f4e38]:
        - generic [ref=f4e39]:
          - paragraph [ref=f4e40]:
            - text: Competitor evidence report ·
            - time [ref=f4e41]: Sep 13, 2026
            - text: –
            - time [ref=f4e42]: Sep 13, 2026
          - heading "Landing page offer changed" [level=1] [ref=f4e43]
          - paragraph [ref=f4e44]: 1 verified-evidence watch event with linked ad context where available.
          - generic [ref=f4e45]:
            - generic [ref=f4e46]:
              - term [ref=f4e47]: Prepared by
              - definition [ref=f4e48]: Agency Fixture Studio
            - generic [ref=f4e49]:
              - term [ref=f4e50]: Subject
              - definition [ref=f4e51]: Agency client proof watch
            - generic [ref=f4e52]:
              - term [ref=f4e53]: Evidence
              - definition [ref=f4e54]: 1 plate
            - generic [ref=f4e55]:
              - term [ref=f4e56]: Generated
              - definition [ref=f4e57]:
                - time [ref=f4e58]: Sep 13, 2026, 2:03 PM
        - region "Report headline numbers" [ref=f4e59]:
          - article [ref=f4e60]:
            - paragraph [ref=f4e61]: Events
            - strong [ref=f4e62]: "1"
            - paragraph [ref=f4e63]: Changes we captured and kept
          - article [ref=f4e64]:
            - paragraph [ref=f4e65]: Linked ads
            - strong [ref=f4e66]: "1"
            - paragraph [ref=f4e67]: Changes with an ad attached
          - article [ref=f4e68]:
            - paragraph [ref=f4e69]: Event types
            - strong [ref=f4e70]: Offer changed
            - paragraph [ref=f4e71]: Kinds of change in the window
        - generic [ref=f4e72]:
          - heading "01What we found" [level=2] [ref=f4e73]
          - complementary [ref=f4e74]:
            - paragraph [ref=f4e75]: Our read
            - paragraph [ref=f4e76]: "Today: review pricing, discount, COD, and bundle pressure before changing your own offer."
          - paragraph [ref=f4e77]: 1 change cleared the evidence bar in this window.
          - paragraph [ref=f4e78]: The evidence is plate 01 below, stamped with the time the capture was taken.
        - region "Report evidence plates" [ref=f4e79]:
          - heading "02The evidence" [level=2] [ref=f4e80]
          - article [ref=f4e82]:
            - generic [ref=f4e83]:
              - generic [ref=f4e84]: PLATE 01 — Offer changed · Okara · Verified evidence
              - time [ref=f4e86]: Sep 13, 2026, 1:01 PM
            - heading "Landing page offer changed" [level=3] [ref=f4e87]
            - paragraph [ref=f4e88]: Agency fixture confirmed proof-backed offer change.
            - generic [ref=f4e89]:
              - generic [ref=f4e91]:
                - img "Okara — stored creative capture" [ref=f4e92]
                - paragraph [ref=f4e93]: New AI workflow launch
                - paragraph [ref=f4e94]: Free trial
                - paragraph [ref=f4e95]: Learn more
                - paragraph [ref=f4e96]: Fixture creative text
                - paragraph [ref=f4e97]: New AI workflow launch
              - generic [ref=f4e99]:
                - generic [ref=f4e100]: What changedOffer changed
                - generic [ref=f4e101]:
                  - text: First seen
                  - time [ref=f4e103]: Sep 13, 2026, 1:02 PM
                - generic [ref=f4e104]: Source statusVerified evidence
                - generic [ref=f4e105]: SourceSaved evidence
                - generic [ref=f4e106]: Source linknone stored
                - generic [ref=f4e107]: Still live atnone stored
                - generic [ref=f4e108]: LanguageEnglish
                - generic [ref=f4e109]: UrgencyHigh priority · 91/100
            - paragraph [ref=f4e110]: "Verified from a page snapshot · 13 Sept, 1:02 pm UTC · \"Free trial\" → \"Starting at ₹499\" · Format: image · Meta ad ID e2e-ad-1 · This is the stored capture, not a re-render."
        - generic [ref=f4e111]:
          - heading "03What we recommend" [level=2] [ref=f4e112]
          - list [ref=f4e113]:
            - listitem [ref=f4e114]:
              - generic [ref=f4e115]: Plate 01
              - paragraph [ref=f4e116]: "Today: review pricing, discount, COD, and bundle pressure before changing your own offer."
        - generic [ref=f4e117]:
          - heading "04Every capture" [level=2] [ref=f4e118]
          - paragraph [ref=f4e119]: The complete trail behind this report — every capture that made it in, with the time it was taken.
          - generic [ref=f4e121]:
            - time [ref=f4e123]: Sep 13, 2026, 1:01 PM
            - paragraph [ref=f4e124]: Plate 01 — Offer changed · Okara
        - generic [ref=f4e125]:
          - heading "05How this was checked" [level=2] [ref=f4e126]
          - generic [ref=f4e127]:
            - generic [ref=f4e128]: Method
            - generic [ref=f4e129]: Subjectadvertiser · Okara
            - generic [ref=f4e130]:
              - text: Window
              - generic [ref=f4e131]:
                - time [ref=f4e132]: Sep 13, 2026
                - text: –
                - time [ref=f4e133]: Sep 13, 2026
            - generic [ref=f4e134]: Verified evidence1
            - generic [ref=f4e135]: Check-spotted0
            - generic [ref=f4e136]: Needs review0
            - generic [ref=f4e137]:
              - text: Generated
              - time [ref=f4e139]: Sep 13, 2026, 2:03 PM
            - generic [ref=f4e140]: Excluded0
          - paragraph [ref=f4e141]: 1 verified-evidence event included. No unreviewed watch events were present.
          - paragraph [ref=f4e142]: Where a number was not published by the source, this report says so rather than estimating it.
          - group [ref=f4e143]:
            - generic "Evidence labels" [ref=f4e144]
      - complementary "Report contents and actions" [ref=f4e145]:
        - generic [ref=f4e147]:
          - paragraph [ref=f4e148]: Approved evidence report
          - generic [ref=f4e149]:
            - checkbox "I reviewed this evidence." [ref=f4e150]
            - text: I reviewed this evidence.
          - paragraph [ref=f4e151]: Tick the box before you send this on. Nothing leaves the workspace until you have read the evidence yourself.
          - button "Send to client" [ref=f4e153]
          - button "Download PDF" [disabled] [ref=f4e155]
          - link "Back to competitor" [ref=f4e156] [cursor=pointer]:
            - /url: /app/watchlists?watchlist=e2e-watchlist-agency-1
            - text: Back to competitor›
        - navigation "Report contents" [ref=f4e157]:
          - paragraph [ref=f4e158]: Contents
          - list [ref=f4e159]:
            - listitem [ref=f4e160]:
              - link "01What we found" [ref=f4e161] [cursor=pointer]:
                - /url: "#report-01"
            - listitem [ref=f4e162]:
              - link "02The evidence" [ref=f4e163] [cursor=pointer]:
                - /url: "#report-02"
            - listitem [ref=f4e164]:
              - link "03What we recommend" [ref=f4e165] [cursor=pointer]:
                - /url: "#report-03"
            - listitem [ref=f4e166]:
              - link "04Every capture" [ref=f4e167] [cursor=pointer]:
                - /url: "#report-04"
            - listitem [ref=f4e168]:
              - link "05How this was checked" [ref=f4e169] [cursor=pointer]:
                - /url: "#report-05"
        - paragraph [ref=f4e171]: This report carries your agency name, Agency Fixture Studio, on every page you send.
```

# Test source

```ts
  46  |   const requestBody = {
  47  |     userId: "e2e-agency",
  48  |     runId,
  49  |     idempotencyKey,
  50  |     scenario: "j4",
  51  |     clock: new Date().toISOString(),
  52  |   };
  53  |   const first = await page.request.post("/api/e2e/j4/replay", {
  54  |     headers: { [fixtureModeHeader]: "1" },
  55  |     data: requestBody,
  56  |   });
  57  |   expect(first.status(), `${action} replay must complete`).toBe(200);
  58  |   const firstBody = await first.json() as Record<string, unknown>;
  59  |   expect(firstBody).toMatchObject({ ok: true, replayed: false });
  60  | 
  61  |   const repeated = await page.request.post("/api/e2e/j4/replay", {
  62  |     headers: { [fixtureModeHeader]: "1" },
  63  |     data: requestBody,
  64  |   });
  65  |   expect(repeated.status(), `${action} replay retry must complete`).toBe(200);
  66  |   const repeatedBody = await repeated.json() as Record<string, unknown>;
  67  |   expect(repeatedBody).toMatchObject({ ok: true, replayed: true });
  68  |   expect({ ...repeatedBody, replayed: false }).toEqual(firstBody);
  69  | 
  70  |   const stateResponse = await page.request.get(
  71  |     `/api/e2e/j4/replay?idempotencyKey=${idempotencyKey}&runId=${runId}`,
  72  |     { headers: { [fixtureModeHeader]: "1" } },
  73  |   );
  74  |   expect(stateResponse.status(), `${action} durable state must be readable`).toBe(200);
  75  |   const state = await stateResponse.json() as Record<string, unknown>;
  76  |   expect(Object.keys(state).sort()).toEqual([
  77  |     "action",
  78  |     "effects",
  79  |     "idempotencyKey",
  80  |     "ok",
  81  |     "provider",
  82  |     "replayStatus",
  83  |     "runId",
  84  |   ]);
  85  |   expect(state).toMatchObject({
  86  |     ok: true,
  87  |     action: action.replaceAll("-", "_"),
  88  |     idempotencyKey,
  89  |     runId,
  90  |     replayStatus: "succeeded",
  91  |     provider: { called: false, reason: "e2e_network_denied" },
  92  |   });
  93  |   const serialized = JSON.stringify(state);
  94  |   expect(serialized).not.toContain("processingToken");
  95  |   expect(serialized).not.toContain("processing_token");
  96  |   expect(serialized).not.toContain("result_json");
  97  |   expect(serialized).not.toContain("shareUrl");
  98  |   expect(serialized).not.toContain('"token"');
  99  | 
  100 |   const effects = state.effects as Record<string, unknown>;
  101 |   expect(Object.keys(effects).sort()).toEqual([
  102 |     "activeShareCount",
  103 |     ...(action === "approval-stale" ? ["approvalInvalidated"] : []),
  104 |     "auditAction",
  105 |     "auditCount",
  106 |     "auditResourceId",
  107 |     "auditResourceType",
  108 |     "auditStatus",
  109 |     "requestFingerprintPresent",
  110 |     "resultPresent",
  111 |     "roomCount",
  112 |     "roomResourceCount",
  113 |     "shareCount",
  114 |   ].sort());
  115 |   return { firstBody, state, effects };
  116 | }
  117 | 
  118 | async function expectNoOverflow(page: Page) {
  119 |   await expectNoHorizontalOverflow(page);
  120 | }
  121 | 
  122 | async function expectTouchTargets(page: Page) {
  123 |   await expectPhoneTouchTargets(page);
  124 |   const undersized = await page
  125 |     .locator("button, a.f9-wk-btn, a.f9-wk-btn-quiet, a.f9-evidence-cta")
  126 |     .evaluateAll((elements) =>
  127 |       elements.flatMap((element) => {
  128 |         const rect = element.getBoundingClientRect();
  129 |         if (!element.checkVisibility() || rect.width === 0 || rect.height === 0) {
  130 |           return [];
  131 |         }
  132 |         return rect.width >= 44 && rect.height >= 44
  133 |           ? []
  134 |           : [
  135 |               {
  136 |                 text: (element.textContent ?? "").trim(),
  137 |                 width: rect.width,
  138 |                 height: rect.height,
  139 |               },
  140 |             ];
  141 |       }),
  142 |     );
  143 |   expect(
  144 |     undersized,
  145 |     "interactive controls should retain a 44px touch target",
> 146 |   ).toEqual([]);
      |     ^ Error: interactive controls should retain a 44px touch target
  147 | }
  148 | 
  149 | async function expectLiveRegion(page: Page, message: string) {
  150 |   // Prefer `.f9-action-feedback` so empty layout `role=status` nodes cannot
  151 |   // steal a `.last()` match under concurrent paint. Fall back to any live
  152 |   // region for pages that surface the same copy without that class.
  153 |   const region = page
  154 |     .locator(".f9-action-feedback")
  155 |     .filter({ hasText: message })
  156 |     .or(
  157 |       page
  158 |         .locator('[role="status"], [role="alert"]')
  159 |         .filter({ hasText: message }),
  160 |     )
  161 |     .first();
  162 |   // The share/report intents round-trip through a server action before the
  163 |   // feedback region renders; on the shared vps-verify runner that can exceed
  164 |   // 15s under fleet load (run 32471530295, 768px share flake) even though the
  165 |   // region persists once rendered. 30s matches the local-release per-test
  166 |   // budget philosophy in playwright.config.ts; the assertion itself is
  167 |   // unchanged and retries stay 0.
  168 |   await expect(region).toBeVisible({ timeout: 30_000 });
  169 |   await expect(region).toHaveAttribute("aria-live", /^(polite|assertive)$/);
  170 | }
  171 | 
  172 | /**
  173 |  * Wait until the share button is idle after a document POST so a still-running
  174 |  * revalidation cannot rewrite controlled fingerprint fields under the next
  175 |  * mutation (Gate-B journey-4 stale-share flake).
  176 |  */
  177 | async function expectShareSubmitIdle(
  178 |   page: Page,
  179 |   form: ReturnType<Page["locator"]>,
  180 | ) {
  181 |   const sendButton = form.getByRole("button", { name: "Send to client" });
  182 |   await expect(sendButton).toBeEnabled();
  183 |   await expect(sendButton).not.toHaveAttribute("aria-busy", "true");
  184 |   await expect
  185 |     .poll(async () => {
  186 |       const busy = await sendButton.getAttribute("aria-busy");
  187 |       return busy === "true" ? "busy" : "idle";
  188 |     })
  189 |     .toBe("idle");
  190 | }
  191 | 
  192 | /**
  193 |  * Set a deliberate stale fingerprint and submit in one evaluate so a late
  194 |  * React re-render cannot restore the loader fingerprint between write and
  195 |  * click.
  196 |  */
  197 | async function submitShareWithStaleFingerprint(
  198 |   form: ReturnType<Page["locator"]>,
  199 | ) {
  200 |   await form.evaluate((node) => {
  201 |     const shareForm = node as HTMLFormElement;
  202 |     const fingerprint = shareForm.querySelector(
  203 |       'input[name="reviewFingerprint"]',
  204 |     ) as HTMLInputElement | null;
  205 |     if (!fingerprint) {
  206 |       throw new Error("share form is missing reviewFingerprint");
  207 |     }
  208 |     fingerprint.value = "stale";
  209 |     if (typeof shareForm.requestSubmit === "function") {
  210 |       shareForm.requestSubmit();
  211 |       return;
  212 |     }
  213 |     shareForm.submit();
  214 |   });
  215 | }
  216 | 
  217 | async function expectKeyboardFocus(page: Page) {
  218 |   const browserName = page.context().browser()?.browserType().name();
  219 |   await page.keyboard.press(focusAdvanceKey(browserName));
  220 |   const control = page.locator(":focus");
  221 |   await expect(control).toBeVisible();
  222 |   await expectVisibleKeyboardFocus(control);
  223 | }
  224 | 
  225 | // BL-009: source coverage moved into the report's "05 — how this was checked"
  226 | // fact rail, and rows became numbered evidence plates (brief §6.6, §6.9). The
  227 | // claim under test is unchanged: the report must index at least one current
  228 | // verified-evidence artifact.
  229 | async function expectCurrentEvidenceArtifactIndex(page: Page) {
  230 |   const method = page.locator("#report-05");
  231 |   await expect(method).toBeVisible();
  232 |   const verifiedEvidence = method
  233 |     .locator(".f9-evidence-fact-row")
  234 |     .filter({ hasText: "Verified evidence" })
  235 |     .locator(".f9-evidence-fact-value");
  236 |   await expect(verifiedEvidence).toHaveText(/^\d+$/u);
  237 |   expect(
  238 |     Number(await verifiedEvidence.textContent()),
  239 |     "the current report must index at least one verified evidence artifact",
  240 |   ).toBeGreaterThan(0);
  241 |   const plates = page.locator(
  242 |     'section[aria-label="Report evidence plates"] .f9-evidence-plate',
  243 |   );
  244 |   expect(
  245 |     await plates.count(),
  246 |     "the report artifact index must contain a current evidence plate",
```