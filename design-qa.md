# BL-039 design QA

## Comparison target

- Source visual truth:
  `/home/nish/workspaces/products/0509-audit-artifacts/landing-rehash-concepts/concept-watchlists-v4-light-1440x900.png`
- Implementation:
  `/home/nish/workspaces/products/0509-audit-artifacts-bl039/after-notifications-starter-1440-light.png`
- Combined comparison:
  `/home/nish/workspaces/products/0509-audit-artifacts-bl039/design-comparison-watchlists-v4-notifications.png`
- Viewport: 1440 × 900 CSS px, light theme, signed-in Starter fixture.
- Source pixels: 2880 × 1800 at 2× density.
- Implementation pixels: 2880 × 2000 full-page at 2× density. The comparison crops
  the implementation to its first 2880 × 1800 pixels so both sides represent the
  same 1440 × 900 CSS viewport at the same density.
- State: the source is the v4 landing-language watchlist reference; the
  implementation is the generally available Notifications state (Email ready,
  Slack dormant, WhatsApp dormant). Content differs by surface intentionally, so
  the comparison judges the shared visual language rather than watchlist-specific
  information architecture.

## Findings

No actionable P0, P1, or P2 differences.

- Fonts and typography: the implementation preserves the source hierarchy with
  the display face on the page title and restrained sans/mono use below it.
  Section and entity labels stay sentence case; the capture probe measured zero
  caps-mono content surfaces. Body wrapping remains readable at 390, 1440, and
  1920 CSS px.
- Spacing and layout rhythm: both views use a black navigation rail, a quiet
  cream work surface, flat rows, radius 0, and 1px separators. The implementation
  starts its first channel row at 228 CSS px on desktop and 274 CSS px on mobile.
  The source title begins higher because it omits the shipped working-header
  utility strip; retaining that current app-shell strip is an intentional product
  constraint, not route drift.
- Colors and tokens: the light comparison keeps the source black/cream/soft-ink
  balance. The dark capture uses the existing inverted tokens without new color
  literals. The live probe found zero painted green marks, which is correct for a
  settings surface with no caught-change announcement.
- Image quality and asset fidelity: neither Notifications nor its v4 language
  target requires imagery, illustration, decorative marks, or non-standard
  icons. No placeholder, generated asset, CSS drawing, custom SVG, emoji, or text
  glyph substitutes an image asset.
- Copy and content: Email is stated as generally available. Slack and WhatsApp
  preserve their exact dormant customer-facing meaning. Quiet-hours, recipient,
  frequency, and history rows remain self-contained and action-oriented.
- Controls and affordances: the select is the native control inside a radius-0
  1px frame; text actions remain visually secondary. The default GA viewport has
  no filled notification action by design. Route tests separately prove the one
  filled `View plans` action in the conditional locked Slack state.
- Responsiveness and accessibility: 24 browser captures and 104 width-sweep
  measurements found zero horizontal page overflow, zero targets under 44px,
  only 1px rules, at most one filled action per viewport, and no console or page
  errors. The narrow screenshot retains the existing horizontally scrollable app
  navigation; notification-owned content does not clip or overlap.

## Open questions

None. The denser production navigation rail and the working-header utility strip
are shipped app-shell constraints outside BL-039 ownership. They do not weaken
the landing-language hierarchy of the route content.

## Focused region comparison

A separate crop was not needed. At equal 2× density, the combined 5760 × 1800
comparison keeps the title, first ruled definition rows, sidebar selection,
frequency control, labels, and 1px boundaries legible. The independent 390px and
dark captures were also opened to check wrapping, native-control treatment, and
token inversion.

## Comparison history

- Pass 1: no P0/P1/P2 findings. No visual fix was made in response, so a second
  comparison iteration was not required.
- Pre-capture hygiene (not a QA iteration): a generated select-arrow text glyph
  was removed in favor of the native select affordance before the evidence set
  was captured.

## Interactions and browser evidence

- Browser-rendered routes: Free, Scout, Starter, and Agency fixtures.
- Themes/viewports: light and dark at 390 × 844, 1440 × 900, and 1920 × 1080,
  deviceScaleFactor 2.
- Primary controls checked: frequency select and save action rendering,
  quiet-hours navigation, account navigation, brief-history navigation, active
  route selection, and theme-responsive control treatment.
- Mutation contracts: route tests verify the unchanged digest, Slack, and
  WhatsApp intents; Gate-B visits and checks notification truth at 375, 768, and
  1440 px without provider mutation.
- Console errors: 0 across all 24 capture states.
- Page errors: 0 across all 24 capture states.

## Implementation checklist

- [x] Preserve the v4 title and ruled-row hierarchy.
- [x] Keep the surface flat, radius 0, and 1px-only.
- [x] Preserve honest delivery state and unchanged action contracts.
- [x] Verify light, dark, mobile, desktop, overflow, targets, and console.

## Follow-up polish

None required for BL-039.

final result: passed
