# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journey-3-release.spec.ts >> Gate-B Journey 3 — monitoring, alerts, and digests >> empty, gated, and recovery states remain honest before any delivery action at 375px
- Location: e2e/journey-3-release.spec.ts:369:5

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
+     "label": "Add competitor",
+     "name": null,
+     "tag": "a",
+     "type": null,
+     "width": 100.875,
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
        - generic [ref=e38]:
          - heading "Briefs" [level=1] [ref=e39]
          - link "Add competitor" [ref=e40] [cursor=pointer]:
            - /url: /search
        - paragraph [ref=e41]: No briefs filed yet. The first completed check files one here.
      - region [ref=e42]:
        - heading "Your first brief lands after the first scan" [level=2] [ref=e43]
        - paragraph [ref=e44]: Add a competitor and the first completed check files one brief here — a finding when something moved, or an honest all-quiet line when it did not.
        - link "See a proof brief" [ref=e45] [cursor=pointer]:
          - /url: /#demo
          - text: See a proof brief ›
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