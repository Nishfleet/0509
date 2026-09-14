# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journey-4-release.spec.ts >> Gate-B Journey 4 — evidence, reports, sharing, export, and client delivery >> exports and share controls expose plan truth before click and do not claim provider delivery at 375px
- Location: e2e/journey-4-release.spec.ts:378:5

# Error details

```
Error: actionable phone controls should be at least 44x44px

expect(received).toEqual(expected) // deep equality

- Expected  -   1
+ Received  + 182

- Array []
+ Array [
+   Object {
+     "className": "f9-skip-link",
+     "height": 17,
+     "label": "Skip to content",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 96.890625,
+   },
+   Object {
+     "className": "f9-wk-wordmark",
+     "height": 17,
+     "label": "Five to Nine",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 80,
+   },
+   Object {
+     "className": "f9-wk-search",
+     "height": 21,
+     "label": "Search…⌘K",
+     "name": null,
+     "tag": "button",
+     "type": null,
+     "width": 93.453125,
+   },
+   Object {
+     "className": "f9-dash-nav-link f9-wk-nav-a",
+     "height": 17,
+     "label": "Competitors",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 79.109375,
+   },
+   Object {
+     "className": "f9-dash-nav-link f9-wk-nav-a is-active",
+     "height": 17,
+     "label": "Briefs",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 39.109375,
+   },
+   Object {
+     "className": "f9-dash-nav-link f9-wk-nav-a",
+     "height": 35,
+     "label": "Account & Billing",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 188.875,
+   },
+   Object {
+     "className": "f9-dash-nav-link f9-wk-nav-a",
+     "height": 17,
+     "label": "Team",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 35.3125,
+   },
+   Object {
+     "className": "f9-dash-nav-link f9-wk-nav-a",
+     "height": 17,
+     "label": "API",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 25.78125,
+   },
+   Object {
+     "className": "f9-dash-nav-link f9-wk-nav-a",
+     "height": 17,
+     "label": "Settings",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 51.5625,
+   },
+   Object {
+     "className": "f9-dash-nav-link f9-wk-nav-a",
+     "height": 17,
+     "label": "Help",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 31.109375,
+   },
+   Object {
+     "className": "f9-wk-btn-quiet f9-sign-out-button",
+     "height": 21,
+     "label": "Sign out",
+     "name": null,
+     "tag": "button",
+     "type": null,
+     "width": 64.921875,
+   },
+   Object {
+     "className": "",
+     "height": 17,
+     "label": "Competitors",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 79.109375,
+   },
+   Object {
+     "className": "is-active",
+     "height": 17,
+     "label": "Briefs",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 39.109375,
+   },
+   Object {
+     "className": "",
+     "height": 35,
+     "label": "Account & Billing",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 188.875,
+   },
+   Object {
+     "className": "",
+     "height": 17,
+     "label": "Team",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 35.3125,
+   },
+   Object {
+     "className": "",
+     "height": 17,
+     "label": "API",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 25.78125,
+   },
+   Object {
+     "className": "",
+     "height": 17,
+     "label": "Settings",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 51.5625,
+   },
+   Object {
+     "className": "",
+     "height": 17,
+     "label": "Help",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 31.109375,
+   },
+   Object {
+     "className": "f9-wk-btn-quiet f9-sign-out-button",
+     "height": 21,
+     "label": "Sign out",
+     "name": null,
+     "tag": "button",
+     "type": null,
+     "width": 64.921875,
+   },
+   Object {
+     "className": "f9-wk-btn",
+     "height": 17,
+     "label": "Upgrade to Agency",
+     "name": null,
+     "tag": "a",
+     "type": null,
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
  251 |         outlineWidth: computed.outlineWidth,
  252 |         outlineColor: computed.outlineColor,
  253 |         boxShadow: computed.boxShadow,
  254 |       } satisfies FocusStyle;
  255 |     });
  256 |   });
  257 |   expect(styles.some(hasVisibleFocusTreatment), "focused control should retain a visible focus treatment").toBe(true);
  258 | }
  259 | 
  260 | export async function expectFocusTransition(from: Locator, to: Locator, key = "Tab"): Promise<void> {
  261 |   await from.focus();
  262 |   await expect(from, "focus transition should start on the source control").toBeFocused();
  263 |   const browserName = from.page().context().browser()?.browserType().name();
  264 |   const advanceKey = focusAdvanceKey(browserName, key);
  265 |   await from.page().keyboard.press(advanceKey);
  266 |   await expect(to, `focus transition should land on ${advanceKey}`).toBeFocused();
  267 | }
  268 | 
  269 | export async function expectStatusAnnouncement(
  270 |   announcement: Locator,
  271 |   expectedText: string | RegExp,
  272 |   role: "status" | "alert" = "status",
  273 | ): Promise<void> {
  274 |   await expect(announcement, "status announcement should be attached").toBeAttached();
  275 |   await expect(announcement).toHaveAttribute("role", role);
  276 |   await expect(announcement).toHaveAttribute("aria-live", /^(?:polite|assertive)$/u);
  277 |   await expect(announcement).toContainText(expectedText);
  278 | }
  279 | 
  280 | export async function expectPhoneTouchTargets(
  281 |   page: Page,
  282 |   minimum = MIN_TOUCH_TARGET_PX,
  283 | ): Promise<void> {
  284 |   const viewport = page.viewportSize();
  285 |   expect(viewport, "phone touch-target checks require a configured viewport").not.toBeNull();
  286 |   if (!viewport || viewport.width > PHONE_MAX_WIDTH) return;
  287 | 
  288 |   const failures = await page.locator("button, a, input, select, textarea, [role='button'], [tabindex]").evaluateAll(
  289 |     (elements, { minSize, epsilon }) => elements
  290 |       .filter((element) => {
  291 |         const html = element as HTMLElement;
  292 |         const style = getComputedStyle(html);
  293 |         const inputType = html instanceof HTMLInputElement ? html.type : "";
  294 |         const labeledControl = inputType === "checkbox" || inputType === "radio"
  295 |           ? html.closest("label")
  296 |           : null;
  297 |         const rect = (labeledControl ?? html).getBoundingClientRect();
  298 |         const isInlineProseLink =
  299 |           html.tagName === "A" &&
  300 |           style.display === "inline" &&
  301 |           Boolean(html.closest("p, li, dd"));
  302 |         // tabindex="-1" on a non-interactive element (e.g. a heading used as
  303 |         // a programmatic focus target) is not a pointer-operable control, so
  304 |         // the WCAG 2.5.5 touch-target floor does not apply to it. Inherently
  305 |         // interactive tags (button/a/input/select/textarea) and role="button"
  306 |         // are still checked even with tabindex="-1".
  307 |         const isInherentlyInteractive =
  308 |           html instanceof HTMLButtonElement ||
  309 |           html.tagName === "A" ||
  310 |           html instanceof HTMLInputElement ||
  311 |           html instanceof HTMLSelectElement ||
  312 |           html instanceof HTMLTextAreaElement ||
  313 |           html.getAttribute("role") === "button";
  314 |         const isProgrammaticFocusTarget =
  315 |           html.getAttribute("tabindex") === "-1" && !isInherentlyInteractive;
  316 |         const isRendered = html.checkVisibility() && rect.width > 0 && rect.height > 0;
  317 |         return (
  318 |           isRendered &&
  319 |           style.display !== "none" &&
  320 |           style.visibility !== "hidden" &&
  321 |           !isInlineProseLink &&
  322 |           !isProgrammaticFocusTarget &&
  323 |           html.getAttribute("aria-hidden") !== "true" &&
  324 |           html.getAttribute("aria-disabled") !== "true" &&
  325 |           !html.hasAttribute("disabled")
  326 |         );
  327 |       })
  328 |       .map((element) => {
  329 |         const html = element as HTMLElement;
  330 |         const inputType = html instanceof HTMLInputElement ? html.type : "";
  331 |         const labeledControl = inputType === "checkbox" || inputType === "radio"
  332 |           ? html.closest("label")
  333 |           : null;
  334 |         const rect = (labeledControl ?? html).getBoundingClientRect();
  335 |         return {
  336 |           label: html.getAttribute("aria-label") || html.textContent?.trim().slice(0, 40) || html.tagName.toLowerCase(),
  337 |           tag: html.tagName.toLowerCase(),
  338 |           type: html instanceof HTMLInputElement ? html.type : null,
  339 |           name: html.getAttribute("name"),
  340 |           className: html.className,
  341 |           width: rect.width,
  342 |           height: rect.height,
  343 |         };
  344 |       })
  345 |       // Use the same sub-pixel epsilon as hasMinimumTouchTarget so a control
  346 |       // that renders at 43.99998px due to font/box rounding is not flagged.
  347 |       .filter((box) => box.width < minSize - epsilon || box.height < minSize - epsilon),
  348 |     { minSize: minimum, epsilon: RENDERED_BOX_EPSILON_PX },
  349 |   );
  350 | 
> 351 |   expect(failures.slice(0, MAX_REPORTED_FAILURES), `actionable phone controls should be at least ${minimum}x${minimum}px`).toEqual([]);
      |                                                                                                                            ^ Error: actionable phone controls should be at least 44x44px
  352 | }
  353 | 
  354 | export async function expectReducedMotionSafe(page: Page, root: Locator = page.locator("body")): Promise<void> {
  355 |   await page.emulateMedia({ reducedMotion: "reduce" });
  356 |   const styles = await root.evaluate((rootElement) => [rootElement, ...rootElement.querySelectorAll("*")]
  357 |     .map((element) => {
  358 |       const computed = getComputedStyle(element);
  359 |       return {
  360 |         element: element.tagName.toLowerCase(),
  361 |         style: {
  362 |           animationName: computed.animationName,
  363 |           animationDuration: computed.animationDuration,
  364 |           transitionProperty: computed.transitionProperty,
  365 |           transitionDuration: computed.transitionDuration,
  366 |           scrollBehavior: computed.scrollBehavior,
  367 |         },
  368 |       };
  369 |     }));
  370 |   const failures = styles
  371 |     .map(({ element, style }) => ({ element, issues: reducedMotionIssues(style) }))
  372 |     .filter(({ issues }) => issues.length > 0)
  373 |     .slice(0, MAX_REPORTED_FAILURES);
  374 | 
  375 |   expect(failures, "reduced-motion mode should disable animated transitions and smooth scrolling").toEqual([]);
  376 | }
  377 | 
```