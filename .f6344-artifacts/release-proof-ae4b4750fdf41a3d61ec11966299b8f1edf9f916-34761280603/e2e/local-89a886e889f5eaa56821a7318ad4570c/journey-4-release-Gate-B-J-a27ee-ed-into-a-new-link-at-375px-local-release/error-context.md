# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journey-4-release.spec.ts >> Gate-B Journey 4 — evidence, reports, sharing, export, and client delivery >> reviewed report share opens anonymously, revokes immediately, and can be re-reviewed into a new link at 375px
- Location: e2e/journey-4-release.spec.ts:668:5

# Error details

```
Error: actionable phone controls should be at least 44x44px

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 20

- Array []
+ Array [
+   Object {
+     "className": "",
+     "height": 17,
+     "label": "agency.example.invalid",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 150.90625,
+   },
+   Object {
+     "className": "f9-evidence-cta f9-evidence-cta--rank2",
+     "height": 17,
+     "label": "Download PDF",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 100.015625,
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
      - status [ref=e38]:
        - paragraph [ref=e39]:
          - text: Snapshot link created.
          - link "http://127.0.0.1:35879/share/d0317081fca94cef8f746fdc57195c92" [ref=e40] [cursor=pointer]:
            - /url: http://127.0.0.1:35879/share/d0317081fca94cef8f746fdc57195c92
          - generic [ref=e41]:
            - button "Copy link" [ref=e42]
            - status
      - generic [ref=e43]:
        - generic [ref=e44]:
          - generic [ref=e45]:
            - paragraph [ref=e46]:
              - text: Competitor evidence report ·
              - time [ref=e47]: Sep 13, 2026
              - text: –
              - time [ref=e48]: Sep 13, 2026
            - heading "Landing page offer changed" [level=1] [ref=e49]
            - paragraph [ref=e50]: 1 verified-evidence watch event with linked ad context where available.
            - generic [ref=e51]:
              - generic [ref=e52]:
                - term [ref=e53]: Prepared by
                - definition [ref=e54]: Agency Fixture Studio
              - generic [ref=e55]:
                - term [ref=e56]: Subject
                - definition [ref=e57]: Agency client proof watch
              - generic [ref=e58]:
                - term [ref=e59]: Evidence
                - definition [ref=e60]: 1 plate
              - generic [ref=e61]:
                - term [ref=e62]: Generated
                - definition [ref=e63]:
                  - time [ref=e64]: Sep 13, 2026, 2:03 PM
          - region "Report headline numbers" [ref=e65]:
            - article [ref=e66]:
              - paragraph [ref=e67]: Events
              - strong [ref=e68]: "1"
              - paragraph [ref=e69]: Changes we captured and kept
            - article [ref=e70]:
              - paragraph [ref=e71]: Linked ads
              - strong [ref=e72]: "1"
              - paragraph [ref=e73]: Changes with an ad attached
            - article [ref=e74]:
              - paragraph [ref=e75]: Event types
              - strong [ref=e76]: Offer changed
              - paragraph [ref=e77]: Kinds of change in the window
          - generic [ref=e78]:
            - heading "01What we found" [level=2] [ref=e79]
            - complementary [ref=e80]:
              - paragraph [ref=e81]: Our read
              - paragraph [ref=e82]: "Today: review pricing, discount, COD, and bundle pressure before changing your own offer."
            - paragraph [ref=e83]: 1 change cleared the evidence bar in this window.
            - paragraph [ref=e84]: The evidence is plate 01 below, stamped with the time the capture was taken.
          - region "Report evidence plates" [ref=e85]:
            - heading "02The evidence" [level=2] [ref=e86]
            - article [ref=e88]:
              - generic [ref=e89]:
                - generic [ref=e90]: PLATE 01 — Offer changed · Okara · Verified evidence
                - time [ref=e92]: Sep 13, 2026, 1:01 PM
              - heading "Landing page offer changed" [level=3] [ref=e93]
              - paragraph [ref=e94]: Agency fixture confirmed proof-backed offer change.
              - generic [ref=e95]:
                - generic [ref=e97]:
                  - img "Okara — stored creative capture" [ref=e98]
                  - paragraph [ref=e99]: New AI workflow launch
                  - paragraph [ref=e100]: Free trial
                  - paragraph [ref=e101]: Learn more
                  - paragraph [ref=e102]: Fixture creative text
                  - paragraph [ref=e103]: New AI workflow launch
                - generic [ref=e105]:
                  - generic [ref=e106]: What changedOffer changed
                  - generic [ref=e107]:
                    - text: First seen
                    - time [ref=e109]: Sep 13, 2026, 1:02 PM
                  - generic [ref=e110]: Source statusVerified evidence
                  - generic [ref=e111]: SourceSaved evidence
                  - generic [ref=e112]: Source linknone stored
                  - generic [ref=e113]: Still live atnone stored
                  - generic [ref=e114]: LanguageEnglish
                  - generic [ref=e115]: UrgencyHigh priority · 91/100
              - paragraph [ref=e116]: "Verified from a page snapshot · 13 Sept, 1:02 pm UTC · \"Free trial\" → \"Starting at ₹499\" · Format: image · Meta ad ID e2e-ad-1 · This is the stored capture, not a re-render."
          - generic [ref=e117]:
            - heading "03What we recommend" [level=2] [ref=e118]
            - list [ref=e119]:
              - listitem [ref=e120]:
                - generic [ref=e121]: Plate 01
                - paragraph [ref=e122]: "Today: review pricing, discount, COD, and bundle pressure before changing your own offer."
          - generic [ref=e123]:
            - heading "04Every capture" [level=2] [ref=e124]
            - paragraph [ref=e125]: The complete trail behind this report — every capture that made it in, with the time it was taken.
            - generic [ref=e127]:
              - time [ref=e129]: Sep 13, 2026, 1:01 PM
              - paragraph [ref=e130]: Plate 01 — Offer changed · Okara
          - generic [ref=e131]:
            - heading "05How this was checked" [level=2] [ref=e132]
            - generic [ref=e133]:
              - generic [ref=e134]: Method
              - generic [ref=e135]: Subjectadvertiser · Okara
              - generic [ref=e136]:
                - text: Window
                - generic [ref=e137]:
                  - time [ref=e138]: Sep 13, 2026
                  - text: –
                  - time [ref=e139]: Sep 13, 2026
              - generic [ref=e140]: Verified evidence1
              - generic [ref=e141]: Check-spotted0
              - generic [ref=e142]: Needs review0
              - generic [ref=e143]:
                - text: Generated
                - time [ref=e145]: Sep 13, 2026, 2:03 PM
              - generic [ref=e146]: Excluded0
            - paragraph [ref=e147]: 1 verified-evidence event included. No unreviewed watch events were present.
            - paragraph [ref=e148]: Where a number was not published by the source, this report says so rather than estimating it.
            - group [ref=e149]:
              - generic "Evidence labels" [ref=e150]
        - complementary "Report contents and actions" [ref=e151]:
          - generic [ref=e153]:
            - paragraph [ref=e154]: Approved evidence report
            - generic [ref=e155]:
              - checkbox "I reviewed this evidence." [checked] [ref=e156]
              - text: I reviewed this evidence.
            - button "Send to client" [ref=e158]
            - button "Download PDF" [ref=e160]
            - link "Back to competitor" [ref=e161] [cursor=pointer]:
              - /url: /app/watchlists?watchlist=e2e-watchlist-agency-1
              - text: Back to competitor›
          - navigation "Report contents" [ref=e162]:
            - paragraph [ref=e163]: Contents
            - list [ref=e164]:
              - listitem [ref=e165]:
                - link "01What we found" [ref=e166] [cursor=pointer]:
                  - /url: "#report-01"
              - listitem [ref=e167]:
                - link "02The evidence" [ref=e168] [cursor=pointer]:
                  - /url: "#report-02"
              - listitem [ref=e169]:
                - link "03What we recommend" [ref=e170] [cursor=pointer]:
                  - /url: "#report-03"
              - listitem [ref=e171]:
                - link "04Every capture" [ref=e172] [cursor=pointer]:
                  - /url: "#report-04"
              - listitem [ref=e173]:
                - link "05How this was checked" [ref=e174] [cursor=pointer]:
                  - /url: "#report-05"
          - paragraph [ref=e176]: This report carries your agency name, Agency Fixture Studio, on every page you send.
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