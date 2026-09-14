# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journey-3-release.spec.ts >> Gate-B Journey 3 — monitoring, alerts, and digests >> pre-seeded empty and recovered monitoring states stay explicit without provider mutation at 375px
- Location: e2e/journey-3-release.spec.ts:421:5

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
+     "className": "f9-dash-nav-link f9-wk-nav-a is-active",
+     "height": 17,
+     "label": "Competitors",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 79.109375,
+   },
+   Object {
+     "className": "f9-dash-nav-link f9-wk-nav-a",
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
+     "className": "is-active",
+     "height": 17,
+     "label": "Competitors",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 79.109375,
+   },
+   Object {
+     "className": "",
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
+     "label": "Upgrade plan",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 86.640625,
+   },
+ ]
```

# Page snapshot

```yaml
- main [ref=f1e2]:
  - link "Skip to content" [ref=f1e3] [cursor=pointer]:
    - /url: "#f9-main-content"
  - generic [ref=f1e4]:
    - complementary "Application" [ref=f1e5]:
      - link "Five to Nine" [ref=f1e7] [cursor=pointer]:
        - /url: /app
      - button "Search…" [ref=f1e8]: Search…⌘K
      - navigation "Workspace" [ref=f1e11]:
        - link "Competitors" [ref=f1e12] [cursor=pointer]:
          - /url: /app
        - link "Briefs" [ref=f1e13] [cursor=pointer]:
          - /url: /app/briefs
        - link "Account & Billing" [ref=f1e14] [cursor=pointer]:
          - /url: /app/account
        - link "Team" [ref=f1e15] [cursor=pointer]:
          - /url: /app/team
        - link "API" [ref=f1e16] [cursor=pointer]:
          - /url: /app/api
        - link "Settings" [ref=f1e17] [cursor=pointer]:
          - /url: /app/settings
        - link "Help" [ref=f1e18] [cursor=pointer]:
          - /url: /app/help
      - generic [ref=f1e19]:
        - generic [ref=f1e20]:
          - text: E
          - generic [ref=f1e21]: E2E Startere2e-starter@example.invalid
        - button "Sign out" [ref=f1e24]
    - navigation "Workspace sections" [ref=f1e25]:
      - link "Competitors" [ref=f1e26] [cursor=pointer]:
        - /url: /app
      - link "Briefs" [ref=f1e27] [cursor=pointer]:
        - /url: /app/briefs
      - link "Account & Billing" [ref=f1e28] [cursor=pointer]:
        - /url: /app/account
      - link "Team" [ref=f1e29] [cursor=pointer]:
        - /url: /app/team
      - link "API" [ref=f1e30] [cursor=pointer]:
        - /url: /app/api
      - link "Settings" [ref=f1e31] [cursor=pointer]:
        - /url: /app/settings
      - link "Help" [ref=f1e32] [cursor=pointer]:
        - /url: /app/help
      - button "Sign out" [ref=f1e34]
    - status
    - generic [ref=f1e36]:
      - generic [ref=f1e37]:
        - generic [ref=f1e38]:
          - heading "Okara competitor watch" [level=1] [ref=f1e39]
          - link "Upgrade plan" [ref=f1e40] [cursor=pointer]:
            - /url: /app/billing?source=watchlists#plans
        - paragraph [ref=f1e41]:
          - link "All competitors" [ref=f1e42] [cursor=pointer]:
            - /url: /app/watchlists
          - text: › Okara · Caught ·
          - link "Needs source access" [ref=f1e43] [cursor=pointer]:
            - /url: /app/source-access
      - article "Okara competitor watch — opened competitor" [ref=f1e45]:
        - heading "Okara competitor watch · Okara · Competitor" [level=2] [ref=f1e46]
        - navigation "Competitor sections" [ref=f1e47]:
          - tablist [ref=f1e48]:
            - tab "What changed2" [selected] [ref=f1e49] [cursor=pointer]
            - tab "Archive" [ref=f1e50] [cursor=pointer]
            - tab "Evidence" [ref=f1e51] [cursor=pointer]
            - tab "Creative" [ref=f1e52] [cursor=pointer]
            - tab "Delivery" [ref=f1e53] [cursor=pointer]
            - tab "Setup" [ref=f1e54] [cursor=pointer]
        - generic [ref=f1e55]:
          - tabpanel "What changed2" [ref=f1e56]:
            - region "What changed" [ref=f1e57]:
              - paragraph [ref=f1e58]: What changed
              - generic [ref=f1e59]:
                - article [ref=f1e61]:
                  - generic [ref=f1e62]:
                    - generic [ref=f1e63]: CAUGHT 13 SEPT · 13:01 UTC · OFFER
                    - text: Verified from a page snapshot · 13 Sept, 6:32 pm GMT+5:30 · "Free trial" → "Starting at ₹499"
                  - generic [ref=f1e64]:
                    - heading "Landing page offer changed" [level=3] [ref=f1e65]
                    - paragraph [ref=f1e66]: Fixture confirmed proof-backed offer change.
                    - paragraph [ref=f1e67]: No alert sent for this change yet.
                    - generic [ref=f1e68]:
                      - generic [ref=f1e69]:
                        - text: Before
                        - time [ref=f1e71]: Sep 12, 2026, 2:00 PM
                        - generic [ref=f1e72]: Free trial
                        - paragraph [ref=f1e73]: “Free trial”
                        - paragraph [ref=f1e74]: capture e2e-proo
                      - generic [ref=f1e75]:
                        - text: Now
                        - time [ref=f1e77]: Sep 13, 2026, 1:01 PM
                        - mark [ref=f1e79]: Starting at ₹499
                        - paragraph [ref=f1e80]: “Starting at ₹499”
                        - paragraph [ref=f1e81]: capture e2e-proo
                    - paragraph [ref=f1e82]: This is the stored capture, not a re-render.
                    - link "Open evidence" [ref=f1e84] [cursor=pointer]:
                      - /url: /app/watchlists?watchlist=e2e-watchlist-starter-1&tab=evidence
                - article [ref=f1e86]:
                  - generic [ref=f1e87]:
                    - generic [ref=f1e88]: CAUGHT 13 SEPT · 13:01 UTC · NEW AD
                    - text: Medium priority · CONFIRMED
                  - generic [ref=f1e89]:
                    - heading "Okara launched a new workflow offer" [level=3] [ref=f1e90]
                    - paragraph [ref=f1e91]: Fixture unenriched ad_new without stored field diff.
                    - paragraph [ref=f1e92]: No alert sent for this change yet.
                    - generic [ref=f1e93]:
                      - time [ref=f1e95]: Sep 13, 2026, 1:01 PM
                      - paragraph [ref=f1e96]: Checked. We recorded a new ad. There is no stored before-and-after field to show.
                    - link "Open evidence" [ref=f1e98] [cursor=pointer]:
                      - /url: /app/watchlists?watchlist=e2e-watchlist-starter-1&tab=evidence
                - article [ref=f1e100]:
                  - generic [ref=f1e101]:
                    - generic [ref=f1e102]: CAUGHT 13 SEPT · 13:03 UTC · AD STATUS
                    - text: Low priority · SUPPRESSED
                  - generic [ref=f1e103]:
                    - heading "Suppressed low-signal change" [level=3] [ref=f1e104]
                    - paragraph [ref=f1e105]: Fixture suppressed item should not dominate trust views.
                    - paragraph [ref=f1e106]: No alert sent for this change yet.
                    - generic [ref=f1e107]:
                      - time [ref=f1e109]: Sep 13, 2026, 1:03 PM
                      - paragraph [ref=f1e110]: Suppressed. This low-signal change is not shown as a before-and-after.
                    - link "Open evidence" [ref=f1e112] [cursor=pointer]:
                      - /url: /app/watchlists?watchlist=e2e-watchlist-starter-1&tab=evidence
            - paragraph [ref=f1e113]:
              - link "Open the capture" [ref=f1e114] [cursor=pointer]:
                - /url: /app/watchlists?watchlist=e2e-watchlist-starter-1&tab=evidence
                - text: Open the capture ›
          - complementary "Competitor facts" [ref=f1e115]:
            - generic [ref=f1e116]:
              - paragraph [ref=f1e117]: Caught · 30 days
              - paragraph [ref=f1e118]: "2"
              - paragraph [ref=f1e119]: 2 changes captured in the last 30 days.
            - generic [ref=f1e120]:
              - generic [ref=f1e121]: What we watch
              - generic [ref=f1e122]: Tracked asCompetitor
              - generic [ref=f1e123]: TargetOkara
              - generic [ref=f1e124]: MarketIndia
              - generic [ref=f1e125]: CadenceChecked every 3–6 hours
              - generic [ref=f1e126]:
                - text: Last check
                - time [ref=f1e128]: 1h ago
              - generic [ref=f1e129]: Watch ageWatching 14 days
              - generic [ref=f1e130]: Proof captures2 good
              - generic [ref=f1e131]: Changes on file3
            - generic [ref=f1e132]:
              - paragraph [ref=f1e133]: Who gets told
              - generic [ref=f1e134]:
                - generic [ref=f1e135]:
                  - term [ref=f1e136]: Email
                  - definition [ref=f1e137]: "On"
                - generic [ref=f1e138]:
                  - term [ref=f1e139]: Instant alerts
                  - definition [ref=f1e140]: On — sent when a scan confirms a major change
                - generic [ref=f1e141]:
                  - term [ref=f1e142]: Digest
                  - definition [ref=f1e143]: "On"
                - generic [ref=f1e144]:
                  - term [ref=f1e145]: Quiet hours
                  - definition [ref=f1e146]: 22:00–08:00 Asia/Kolkata
                - generic [ref=f1e147]:
                  - term [ref=f1e148]: Recipients
                  - definition [ref=f1e149]: Workspace default address
              - link "Delivery settings" [ref=f1e150] [cursor=pointer]:
                - /url: /app/watchlists?watchlist=e2e-watchlist-starter-1&tab=delivery
      - generic [ref=f1e151]:
        - generic [ref=f1e152]: 3 competitors
        - generic [ref=f1e153]: Next check Sun 13 Sept, 8:30 pm GMT+5:30
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