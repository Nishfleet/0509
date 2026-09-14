# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journey-4-release.spec.ts >> Gate-B Journey 4 — evidence, reports, sharing, export, and client delivery >> client rooms make empty and gated delivery states explicit before room creation at 768px
- Location: e2e/journey-4-release.spec.ts:592:5

# Error details

```
Error: interactive controls should retain a 44px touch target

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 27

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
+     "height": 21,
+     "text": "Cancel",
+     "width": 57.5,
+   },
+   Object {
+     "height": 21,
+     "text": "Save client room",
+     "width": 115.265625,
+   },
+ ]
```

# Page snapshot

```yaml
- main [ref=e2]:
  - link "Skip to content" [ref=e3] [cursor=pointer]:
    - /url: "#f9-main-content"
  - generic [ref=e4]:
    - complementary "Application" [ref=e5]:
      - link "Five to Nine" [ref=e7] [cursor=pointer]:
        - /url: /app
      - button "Search…" [ref=e8]: Search…⌘K
      - navigation "Workspace" [ref=e11]:
        - link "Competitors" [ref=e12] [cursor=pointer]:
          - /url: /app
        - link "Briefs" [ref=e13] [cursor=pointer]:
          - /url: /app/briefs
        - link "Account & Billing" [ref=e14] [cursor=pointer]:
          - /url: /app/account
        - link "Team" [ref=e15] [cursor=pointer]:
          - /url: /app/team
        - link "API" [ref=e16] [cursor=pointer]:
          - /url: /app/api
        - link "Settings" [ref=e17] [cursor=pointer]:
          - /url: /app/settings
        - link "Help" [ref=e18] [cursor=pointer]:
          - /url: /app/help
      - generic [ref=e19]:
        - generic [ref=e20]:
          - text: E
          - generic [ref=e21]: E2E Agencye2e-agency@example.invalid
        - button "Sign out" [ref=e24]
    - navigation "Workspace sections" [ref=e25]:
      - link "Competitors" [ref=e26] [cursor=pointer]:
        - /url: /app
      - link "Briefs" [ref=e27] [cursor=pointer]:
        - /url: /app/briefs
      - link "Account & Billing" [ref=e28] [cursor=pointer]:
        - /url: /app/account
      - link "Team" [ref=e29] [cursor=pointer]:
        - /url: /app/team
      - link "API" [ref=e30] [cursor=pointer]:
        - /url: /app/api
      - link "Settings" [ref=e31] [cursor=pointer]:
        - /url: /app/settings
      - link "Help" [ref=e32] [cursor=pointer]:
        - /url: /app/help
      - button "Sign out" [ref=e34]
    - status
    - generic [ref=e36]:
      - generic [ref=e37]:
        - heading "Client rooms" [level=1] [ref=e39]
        - paragraph [ref=e40]: 0 active · 0 archived. Keep reviewed evidence and client context together for handoff.
      - region [ref=e41]:
        - generic [ref=e42]:
          - generic [ref=e43]:
            - paragraph [ref=e44]: New client room
            - heading "Bundle evidence and notes" [active] [level=2] [ref=e45]
          - button "Cancel" [ref=e46]
        - generic [ref=e47]:
          - generic [ref=e48]:
            - generic [ref=e49]:
              - text: Name
              - textbox "Name" [ref=e50]:
                - /placeholder: Nykaa weekly desk
            - generic [ref=e51]:
              - text: Client label
              - textbox "Client label" [ref=e52]:
                - /placeholder: Nykaa
          - generic [ref=e53]:
            - text: Goal
            - textbox "Goal" [ref=e54]:
              - /placeholder: What the client wants from the weekly review
          - generic [ref=e55]:
            - generic [ref=e56]:
              - text: Cadence
              - textbox "Cadence" [ref=e57]:
                - /placeholder: Weekly
            - generic [ref=e58]:
              - text: Tone
              - textbox "Tone" [ref=e59]:
                - /placeholder: Direct, client-ready
          - group "Competitors" [ref=e60]:
            - generic [ref=e62]:
              - generic [ref=e63]:
                - generic [ref=e64]:
                  - checkbox "Agency quiet proof watch" [ref=e65]
                  - text: Agency quiet proof watch
                - generic [ref=e66]:
                  - checkbox "Include reviewed report for Agency quiet proof watch" [ref=e67]
                  - text: Include reviewed report
              - generic [ref=e68]:
                - generic [ref=e69]:
                  - checkbox "Agency client proof watch" [ref=e70]
                  - text: Agency client proof watch
                - generic [ref=e71]:
                  - checkbox "Include reviewed report for Agency client proof watch" [ref=e72]
                  - text: Include reviewed report
          - group "Collections" [ref=e73]:
            - paragraph [ref=e75]: Create a collection before linking saved evidence.
          - button "Save client room" [ref=e76]
      - region [ref=e77]:
        - generic [ref=e78]:
          - generic [ref=e79]:
            - paragraph [ref=e80]: Active rooms
            - heading "Client delivery" [level=2] [ref=e81]
          - generic [ref=e82]: 0 rooms
        - status [ref=e84]:
          - heading "No client rooms yet" [level=3] [ref=e85]
          - paragraph [ref=e86]: Create one room when a client needs reviewed evidence, reports, and delivery notes kept together.
      - group [ref=e87]:
        - generic [ref=e88]:
          - generic [ref=e89]:
            - strong [ref=e90]: Saved context
            - text: Report preferences, tone, and follow-up notes
          - text: 0 loaded memories
        - option "Account" [selected]
        - option "Customer"
        - option "Brand"
        - option "Competitor"
        - option "Account-wide" [selected]
      - group [ref=e91]:
        - generic "Archived roomsKept out of the active handoff list0 archived" [ref=e92]:
          - generic [ref=e93]:
            - strong [ref=e94]: Archived rooms
            - text: Kept out of the active handoff list
          - generic [ref=e95]: 0 archived
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