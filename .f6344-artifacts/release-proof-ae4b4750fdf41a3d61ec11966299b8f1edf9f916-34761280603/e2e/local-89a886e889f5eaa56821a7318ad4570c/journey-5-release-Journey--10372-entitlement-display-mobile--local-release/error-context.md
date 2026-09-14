# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journey-5-release.spec.ts >> Journey 5 release: plan, checkout, entitlements, billing >> holds plan boundaries and proves entitlement display (mobile)
- Location: e2e/journey-5-release.spec.ts:160:5

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
+     "className": "f9-dash-nav-link f9-wk-nav-a",
+     "height": 17,
+     "label": "Briefs",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 39.109375,
+   },
+   Object {
+     "className": "f9-dash-nav-link f9-wk-nav-a is-active",
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
+     "className": "",
+     "height": 17,
+     "label": "Briefs",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 39.109375,
+   },
+   Object {
+     "className": "is-active",
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
+     "label": "Choose a plan",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 90.65625,
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
          - generic [ref=e21]: E2E Free Onboardede2e-free-onboarded@example.invalid
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
        - heading "Billing & usage" [level=1] [ref=e39]
        - paragraph [ref=e40]: Free plan. Usage, renewal, and provider-backed billing controls.
      - generic [ref=e41]:
        - article [ref=e42]:
          - generic [ref=e43]:
            - text: Free account
            - heading "No paid plan is active." [level=2] [ref=e44]
            - paragraph [ref=e45]: Choose a plan below to start paid monitoring.
            - link "Choose a plan" [ref=e46] [cursor=pointer]:
              - /url: /app/billing?source=billing#plans
          - generic [ref=e47]: "Current status: Free account."
        - article [ref=e48]:
          - generic [ref=e49]:
            - generic [ref=e50]:
              - text: Choose inside the app
              - heading "Pick a plan and billing cycle" [level=2] [ref=e51]
              - paragraph [ref=e52]: Prices are shown in your local currency automatically. Pay annually and get 4 months free.
            - group "Billing cycle" [ref=e53]:
              - link "Monthly" [ref=e54] [cursor=pointer]:
                - /url: /app/billing?plan=starter&cycle=monthly&source=e2e#plans
              - link "Annual" [ref=e55] [cursor=pointer]:
                - /url: /app/billing?plan=starter&cycle=yearly&source=e2e#plans
          - status [ref=e56]:
            - paragraph [ref=e57]: Prices are temporarily unavailable — try again shortly
          - generic [ref=e58]:
            - generic [ref=e59]:
              - generic [ref=e61]:
                - heading "Scout" [level=3] [ref=e62]
                - strong [ref=e63]: Price didn’t load — we’re retrying. Refresh in a moment.
              - paragraph [ref=e64]: 6-hour competitor monitoring for a small watchlist.
              - generic "Scout limits" [ref=e65]:
                - generic [ref=e66]: 3 watchlists
                - generic [ref=e67]: 10 Collections
                - generic [ref=e68]: 50 proof captures/mo
              - paragraph [ref=e69]: Annual checkout is unavailable while pricing syncs. Monthly checkout still works.
              - list [ref=e70]:
                - listitem [ref=e71]: Proof brief before signup
                - listitem [ref=e72]: Read-only API + MCP access
                - listitem [ref=e73]: 3 active watchlists
                - listitem [ref=e74]: 10 Collections
                - listitem [ref=e75]: 6-hour scans
              - button "Waiting for the live price" [disabled] [ref=e77]
            - generic [ref=e78]:
              - generic [ref=e79]:
                - generic [ref=e80]:
                  - heading "Starter" [level=3] [ref=e81]
                  - strong [ref=e82]: Price didn’t load — we’re retrying. Refresh in a moment.
                - text: Recommended
              - paragraph [ref=e83]: 3-hour competitor monitoring for one brand's core market.
              - generic "Starter limits" [ref=e84]:
                - generic [ref=e85]: 10 watchlists
                - generic [ref=e86]: 25 Collections
                - generic [ref=e87]: 250 proof captures/mo
              - paragraph [ref=e88]: Annual checkout is unavailable while pricing syncs. Monthly checkout still works.
              - list [ref=e89]:
                - listitem [ref=e90]: 10 active watchlists
                - listitem [ref=e91]: 25 Collections
                - listitem [ref=e92]: 3-hour scans
                - listitem [ref=e93]: Daily + weekly Briefs
                - listitem [ref=e94]: 250 proof captures/month
              - button "Waiting for the live price" [disabled] [ref=e96]
            - generic [ref=e97]:
              - generic [ref=e99]:
                - heading "Agency" [level=3] [ref=e100]
                - strong [ref=e101]: Price didn’t load — we’re retrying. Refresh in a moment.
              - paragraph [ref=e102]: 75 competitors — top 25 checked every 3 hours, the rest every 6 hours, with client-ready reports.
              - generic "Agency limits" [ref=e103]:
                - generic [ref=e104]: 75 watchlists
                - generic [ref=e105]: 250 Collections
                - generic [ref=e106]: 2,500 proof captures/mo
              - paragraph [ref=e107]: Annual checkout is unavailable while pricing syncs. Monthly checkout still works.
              - list [ref=e108]:
                - listitem [ref=e109]: 75 active watchlists
                - listitem [ref=e110]: 250 Collections
                - listitem [ref=e111]: Top 25 competitors every 3 hours; rest every 6 hours
                - listitem [ref=e112]: Daily + weekly Briefs
                - listitem [ref=e113]: 2,500 proof captures/month
              - link "Request Agency access" [active] [ref=e115] [cursor=pointer]:
                - /url: /app/support?category=billing
        - article [ref=e116]:
          - generic [ref=e117]:
            - generic [ref=e118]:
              - text: Plan & billing
              - heading "Free plan — free account" [level=2] [ref=e119]
            - link "View plans" [ref=e120] [cursor=pointer]:
              - /url: /app/billing?source=billing#plans
          - generic [ref=e121]:
            - generic [ref=e122]:
              - strong [ref=e123]: Status
              - text: Free account
            - generic [ref=e124]:
              - strong [ref=e125]: Last billing change
              - time [ref=e127]: Sep 13, 2026
            - generic [ref=e128]:
              - strong [ref=e129]: Competitor watchlists
              - text: 0 of 1 used
            - generic [ref=e130]:
              - strong [ref=e131]: Collections
              - generic [ref=e132]:
                - text: Not included on this plan —
                - link "view plans" [ref=e133] [cursor=pointer]:
                  - /url: /app/billing?source=collections#plans
            - generic [ref=e134]:
              - strong [ref=e135]: Proof captures (this month)
              - generic [ref=e136]:
                - text: 0 of 1 included used · period
                - time [ref=e137]: Sep 1, 2026
                - text: –
                - time [ref=e138]: Oct 1, 2026
            - paragraph [ref=e139]: Scheduled scans are included with your plan and never touch your cap. A proof capture is used when Five to Nine saves a confirmed change with page text, the original link, and a screenshot when the capture includes one. Included caps are generous and reset monthly; purchased proof captures never expire and carry over until you use them.
            - generic [ref=e140]:
              - strong [ref=e141]: Digest schedule
              - text: Weekly
        - article [ref=e142]:
          - generic [ref=e144]:
            - text: Proof capture packs
            - heading "Top up busy weeks without changing plans" [level=2] [ref=e145]
            - paragraph [ref=e146]: Purchased proof captures never expire and carry over until you use them. They add capture volume only; they do not change watchlist limits, cadence, or plan features.
          - generic [ref=e147]:
            - generic [ref=e148]:
              - text: 500 extra proof captures
              - heading "Burst Pack" [level=3] [ref=e149]
              - strong [ref=e150]: Price didn’t load — we’re retrying. Refresh in a moment.
              - paragraph [ref=e151]: For sale-week spikes when campaigns need extra proof-backed captures.
              - link "Choose a plan first" [ref=e152] [cursor=pointer]:
                - /url: /app/billing?source=top-up#plans
            - generic [ref=e153]:
              - text: 2,000 extra proof captures
              - heading "Campaign Pack" [level=3] [ref=e154]
              - strong [ref=e155]: Price didn’t load — we’re retrying. Refresh in a moment.
              - paragraph [ref=e156]: Overflow proof-capture volume for active launches and promo weeks.
              - link "Choose a plan first" [ref=e157] [cursor=pointer]:
                - /url: /app/billing?source=top-up#plans
            - generic [ref=e158]:
              - text: 7,500 extra proof captures
              - heading "Scale Pack" [level=3] [ref=e159]
              - strong [ref=e160]: Price didn’t load — we’re retrying. Refresh in a moment.
              - paragraph [ref=e161]: Bulk proof-capture volume for agencies tracking heavy categories.
              - link "Choose a plan first" [ref=e162] [cursor=pointer]:
                - /url: /app/billing?source=top-up#plans
        - article [ref=e163]:
          - generic [ref=e165]:
            - text: Manage billing
            - heading "Change, cancel, or get invoices" [level=2] [ref=e166]
          - generic [ref=e167]:
            - generic [ref=e168]:
              - strong [ref=e169]: Change or cancel your plan
              - generic [ref=e170]:
                - link "Open a billing support case" [ref=e171] [cursor=pointer]:
                  - /url: /app/support?category=billing
                - text: from e2e-free-onboarded@example.invalid. Paid access has ended. Choose a plan to start again.
            - generic [ref=e172]:
              - strong [ref=e173]: Receipts and invoices
              - generic [ref=e174]:
                - text: Dodo Payments emails a receipt for every charge. Need a copy or a GST invoice?
                - link "Open a billing support case" [ref=e175] [cursor=pointer]:
                  - /url: /app/support?category=billing
                - text: .
            - generic [ref=e176]:
              - strong [ref=e177]: Refunds
              - generic [ref=e178]:
                - text: Questions about a charge, cancellation, or refund?
                - link "Email support@0509.io" [ref=e179] [cursor=pointer]:
                  - /url: mailto:support@0509.io
                - text: or
                - link "open a billing support case" [ref=e180] [cursor=pointer]:
                  - /url: /app/support?category=billing
                - text: . See the
                - link "current Terms" [ref=e181] [cursor=pointer]:
                  - /url: /terms
                - text: for the applicable terms.
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