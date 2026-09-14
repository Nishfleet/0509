# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journey-2-release.spec.ts >> Gate-B Journey 2: onboarding creates the first tracked competitor (mobile)
- Location: e2e/journey-2-release.spec.ts:223:3

# Error details

```
Error: touch target should be at least 44x44px; measured 185.00x21.00px

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
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
          - generic [ref=e21]: E2E Activatione2e-activation@example.invalid
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
        - heading "Today" [level=1] [ref=e39]
        - paragraph [ref=e40]: Welcome — your first scan starts from the setup card below.
      - region [ref=e41]:
        - paragraph [ref=e42]: Brief retention
        - generic [ref=e43]:
          - generic [ref=e44]:
            - term [ref=e45]: Since last brief
            - definition [ref=e46]: No filed changes this period — the brief is anchored to the previous run on file.
          - generic [ref=e47]:
            - term [ref=e48]: Accountable reviewer
            - definition [ref=e49]: Workspace owner
          - generic [ref=e50]:
            - term [ref=e51]: Confidence
            - definition [ref=e52]: Confidence unavailable — no filed events on this brief.
          - generic [ref=e53]:
            - term [ref=e54]: Expiry
            - definition [ref=e55]: Expires at the next check — Mon 14 Sept, 3:00 am UTC.
      - region [ref=e57]:
        - generic [ref=e58]:
          - generic [ref=e59]: Setup · 0 of 4 done
          - heading "Finish the workspace that sends your first brief" [level=2] [ref=e60]
        - generic [ref=e61]:
          - generic [ref=e62]:
            - text: Competitor website
            - textbox "Competitor website" [ref=e63]:
              - /placeholder: https://competitor.com
          - text: We create the watchlist and start its first scan immediately.
          - button "Track this competitor" [disabled] [ref=e64]
        - list [ref=e65]:
          - listitem [ref=e66]:
            - text: Next
            - generic [ref=e67]:
              - strong [ref=e68]: First competitor
              - text: Paste one competitor website to start.
          - listitem [ref=e69]:
            - text: Pending
            - generic [ref=e70]:
              - strong [ref=e71]: First watchlist
              - text: Create one retained watchlist.
          - listitem [ref=e72]:
            - text: Pending
            - generic [ref=e73]:
              - strong [ref=e74]: First evidence
              - text: Refresh a watchlist to capture landing-page evidence.
          - listitem [ref=e75]:
            - text: Pending
            - generic [ref=e76]:
              - strong [ref=e77]: First digest
              - text: Digest history appears after monitored changes.
        - group [ref=e78]:
          - generic "Add several competitors by paste or CSV" [ref=e79]
        - generic [ref=e80]:
          - link "Search first instead" [ref=e81] [cursor=pointer]:
            - /url: /search
          - link "Add your brand website" [ref=e82] [cursor=pointer]:
            - /url: /app/account#brand-profile
      - region [ref=e83]:
        - paragraph [ref=e84]: Overnight
        - paragraph [ref=e85]: Build your brief. Add your first competitor — free includes one first check and one first brief, Meta Ad Library only. Paid plans check every 3–6 hours.
      - region [ref=e86]:
        - paragraph [ref=e87]: What changed
        - paragraph [ref=e88]: Nothing filed yet — add a competitor and the first capture starts the evidence trail.
      - region [ref=e89]:
        - paragraph [ref=e90]: Still running
        - generic "Still running" [ref=e91]:
          - generic [ref=e92]:
            - link "Competitors" [ref=e94] [cursor=pointer]:
              - /url: /app/watchlists
            - text: Nothing is being watched yet. Add a competitor and its first check starts immediately.0›
          - generic [ref=e95]:
            - link "Evidence captures" [ref=e97] [cursor=pointer]:
              - /url: /app/billing?source=evidence#top-ups
            - text: 0 of 1 proof captures used in the current billing period.1 left this month›
          - generic [ref=e98]:
            - link "Source access" [ref=e100] [cursor=pointer]:
              - /url: /app/source-access
            - text: Live ad checks aren't configured yet, so searches show labeled sample data.Source setup needed›
          - generic [ref=e101]:
            - link "No first watchlist yet" [ref=e103] [cursor=pointer]:
              - /url: /search
            - text: Add one competitor so the first sweep and source trail can start.›
      - generic [ref=e104]:
        - generic [ref=e105]: Last check not yet
        - generic [ref=e106]: Next check Mon 14 Sept, 3:00 am UTC
        - text: 1 proof captures left this period
```

# Test source

```ts
  111 |         const style = getComputedStyle(element);
  112 |         // Inline boxes do not establish a scroll container. Firefox reports
  113 |         // their text width as scrollWidth while clientWidth remains zero,
  114 |         // which is not page overflow. Document-level overflow below still
  115 |         // catches inline content that genuinely escapes the viewport.
  116 |         if (style.display === "inline" || style.display === "contents") return false;
  117 |         const overflowX = style.overflowX;
  118 |         return !["auto", "scroll", "hidden", "clip"].includes(overflowX);
  119 |       })
  120 |       .map(({ element, overflow }) => ({
  121 |         selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.className && typeof element.className === "string" ? `.${element.className.trim().split(/\s+/u).join(".")}` : ""}`,
  122 |         overflow,
  123 |       }))
  124 |       .slice(0, maxReportedFailures);
  125 |     return {
  126 |       document: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  127 |       nested,
  128 |     };
  129 |   }, { allowed: tolerance, maxReportedFailures: MAX_REPORTED_FAILURES });
  130 | 
  131 |   expect(overflow.document, "document should not overflow horizontally").toBeLessThanOrEqual(tolerance);
  132 |   expect(overflow.nested, "nested elements should not overflow horizontally").toEqual([]);
  133 | }
  134 | 
  135 | /**
  136 |  * Playwright `boundingBox().y` is visual-viewport relative. Mobile Chrome
  137 |  * keeps a ~32px visual offset after `fill()` (Gate-B Journey 2 CI reported
  138 |  * box.y=-31.734375). Adding `visualViewport.offsetTop` maps that back to the
  139 |  * layout viewport the fold assertion is about — unconditionally, so a
  140 |  * positive rawTop with a non-zero offset cannot sneak past the fold check.
  141 |  * A still-negative result is a real layout defect, not the visual chrome.
  142 |  */
  143 | export function layoutViewportY(visualY: number, visualOffsetTop: number): number {
  144 |   return visualY + visualOffsetTop;
  145 | }
  146 | 
  147 | export async function expectPrimaryActionAboveFold(
  148 |   action: Locator,
  149 |   label = "primary next action",
  150 | ): Promise<void> {
  151 |   await expect(action, `${label} should be visible`).toBeVisible();
  152 |   const page = action.page();
  153 |   // fill() / focus auto-scrolls the visual viewport. Restore the page's
  154 |   // initial view (hash target, else document origin) and blur so nothing
  155 |   // keeps fighting the reset, then measure layout coordinates.
  156 |   await page.evaluate(() => {
  157 |     const active = document.activeElement;
  158 |     if (active instanceof HTMLElement && active !== document.body) {
  159 |       active.blur();
  160 |     }
  161 |     const id = window.location.hash.replace(/^#/u, "");
  162 |     const target = id ? document.getElementById(id) : null;
  163 |     if (target) {
  164 |       target.scrollIntoView({ block: "start", inline: "nearest" });
  165 |       return;
  166 |     }
  167 |     window.scrollTo(0, 0);
  168 |   });
  169 |   await page.evaluate(
  170 |     () =>
  171 |       new Promise<void>((resolve) => {
  172 |         requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  173 |       }),
  174 |   );
  175 |   const metrics = await action.evaluate((element) => {
  176 |     const rect = element.getBoundingClientRect();
  177 |     return {
  178 |       y: rect.top,
  179 |       height: rect.height,
  180 |       visualOffset: window.visualViewport?.offsetTop ?? 0,
  181 |     };
  182 |   });
  183 |   const viewport = page.viewportSize();
  184 |   expect(viewport, `${label} requires a configured viewport`).not.toBeNull();
  185 |   if (!viewport) return;
  186 |   const y = layoutViewportY(metrics.y, metrics.visualOffset);
  187 |   process.stdout.write(
  188 |     `GATE-B ${label} box.y=${y} visualOffset=${metrics.visualOffset} rawTop=${metrics.y}\n`,
  189 |   );
  190 |   expect(
  191 |     y,
  192 |     `${label} should begin inside the initial viewport (box.y=${y} visualOffset=${metrics.visualOffset} rawTop=${metrics.y})`,
  193 |   ).toBeGreaterThanOrEqual(0);
  194 |   expect(
  195 |     y + metrics.height,
  196 |     `${label} should be above the initial viewport fold`,
  197 |   ).toBeLessThanOrEqual(viewport.height);
  198 | }
  199 | 
  200 | export async function expectMinimumTouchTarget(
  201 |   control: Locator,
  202 |   minimum = MIN_TOUCH_TARGET_PX,
  203 | ): Promise<void> {
  204 |   await expect(control, "touch target should be visible").toBeVisible();
  205 |   const box = await control.boundingBox();
  206 |   expect(box, "touch target should have a measurable bounding box").not.toBeNull();
  207 |   if (!box) return;
  208 |   expect(
  209 |     hasMinimumTouchTarget(box, minimum),
  210 |     `touch target should be at least ${minimum}x${minimum}px; measured ${box.width.toFixed(2)}x${box.height.toFixed(2)}px`,
> 211 |   ).toBe(true);
      |     ^ Error: touch target should be at least 44x44px; measured 185.00x21.00px
  212 | }
  213 | 
  214 | export async function expectSecHeadingsNonZeroWidth(page: Page): Promise<void> {
  215 |   // Issue #1842 regression guard: at tablet (768px) the section header is a
  216 |   // flex row (.f9-wk-sec-head, justify-content: space-between) holding the
  217 |   // title container (.f9-wk-sec-headings, min-width: 0) and the actions block
  218 |   // (.f9-wk-sec-acts, flex: 0 0 auto, flex-wrap: nowrap). When the actions
  219 |   // overflow the row, .f9-wk-sec-headings collapses to width: 0 — the title
  220 |   // stays in the DOM but is invisible. toBeVisible() catches the symptom;
  221 |   // this pins the cause by asserting the headings container keeps a non-zero
  222 |   // width whenever the actions are present, on every viewport the journey
  223 |   // runs (mobile wraps, desktop has room, tablet is the dead zone).
  224 |   //
  225 |   // Both elements are asserted present (not silently skipped): the empty
  226 |   // state always renders the pair, so a missing .f9-wk-sec-acts would be a
  227 |   // real markup regression and must fail loudly rather than pass the guard.
  228 |   const secActs = page.locator(".f9-wk-sec-acts").first();
  229 |   await expect(secActs, ".f9-wk-sec-acts should be present and visible").toHaveCount(1);
  230 |   await expect(secActs, ".f9-wk-sec-acts should be visible").toBeVisible();
  231 |   const headings = page.locator(".f9-wk-sec-headings").first();
  232 |   await expect(headings, ".f9-wk-sec-headings should be present").toHaveCount(1);
  233 |   const box = await headings.boundingBox();
  234 |   expect(box, ".f9-wk-sec-headings should render a bounding box").not.toBeNull();
  235 |   if (!box) return;
  236 |   expect(
  237 |     box.width,
  238 |     ".f9-wk-sec-headings must keep non-zero width so .f9-wk-sec-acts cannot collapse it (tablet guard, #1842)",
  239 |   ).toBeGreaterThan(0);
  240 | }
  241 | 
  242 | export async function expectVisibleKeyboardFocus(control: Locator): Promise<void> {
  243 |   await control.focus();
  244 |   await expect(control, "keyboard focus should land on the control").toBeFocused();
  245 |   const styles = await control.evaluate((element) => {
  246 |     const candidates = [element, element.parentElement, element.parentElement?.parentElement].filter(Boolean) as Element[];
  247 |     return candidates.map((candidate) => {
  248 |       const computed = getComputedStyle(candidate);
  249 |       return {
  250 |         outlineStyle: computed.outlineStyle,
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
```