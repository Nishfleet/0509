# Email brief — case-file design overhaul (issue #1556)

The email brief is the product's most-seen surface for a retained user. This
record documents the audit, the design system applied, and the client
constraints that shape it.

## 1. Scope of the audit

In scope (the brief surfaces — restyled to the case-file system):

- Daily / weekly digest emails (`app/lib/digest-email.server.ts`): the main
  brief, all-quiet digest, zero-noise triage digest, scan-trouble notice,
  record-failure state.
- Instant alert emails (`app/lib/delivery.server.ts` →
  `buildInstantAlertContent`).
- Presence digest (`renderPresenceDigestHtml`).
- Monthly customer recap (`app/lib/monthly-recap.server.ts`).
- The shared send-time shell (`app/lib/email-template.server.ts`).

Out of scope (deliberately left on the plain white shell): transactional
account and billing emails (welcome, verification, password reset, billing
lifecycle). Those are not the brief; restyling them would change legal/
support-facing surfaces for no retention gain. They keep the historical
byte-identical output.

## 2. Audit findings — gaps before this change

The brief surfaces shipped a generic SaaS email look that did not match the
landing page:

| Landing page (design system) | Email brief before |
|---|---|
| Bone ground `#F4F1E8`, ink text `#171611` | White `#ffffff`, grey-blue text `#0b1220`/`#475467` |
| Card surfaces `#fffdf8`, ink rules | `#d7dce5` borders, 12px rounded corners |
| Signal-green `#16C47F` accents | No accent colour |
| Bricolage Grotesque 800 display heads | Inter 700 |
| IBM Plex Mono evidence/timestamps | Inter for everything |
| Hard offset shadows, square corners | Soft shadow-less rounded borders |
| Dotted / dashed hand-drawn connectors | Solid hairline borders |
| Honest proof-strip ("Live proof" / "On record", "No proof, no claim") | No stamps, no proof foot |

A user who saw the polished landing page then opened a plain-looking email
experienced exactly the trust drop §3.6 of the research calls out.

## 3. The design system, applied to email

Emails cannot load `app/app.css`, web fonts, or CSS custom properties, so the
case-file system ships as inline styles with the tokens as constants in
`app/lib/email-template.server.ts` (documented there against the landing
`:root` bed and the `.ld-proof-strip` framing — the issue's own greps for
`ld-proof-strip` / `case-file` / `signal-green` resolve in that module).

| Token | Value |
|---|---|
| Bone (ground) | `#f4f1e8` |
| Card (surface) | `#fffdf8` |
| Ink (text, rules) | `#171611` |
| Ink soft / faint | `#55524a` / `#6e6a5e` |
| Line (dotted connectors) | `#e0ddd4` |
| Signal green | `#16c47f` |
| Green ink (on-green text) | `#064d31` |
| Green wash | `#d9f6e8` |
| Display font | `"Bricolage Grotesque", Georgia, serif` |
| Mono font | `"IBM Plex Mono", Consolas, monospace` |

Frame anatomy (the case-file shell, `renderEmailShell({ theme: "case-file" })`):

- Bone ground, card body, ink rule border, hard offset shadow
  `4px 4px 0 rgba(23,22,17,.14)` (degrades gracefully where mail clients
  strip `box-shadow`).
- Ink header band with the signal-green live dot — the `.ld-proof-strip-head`
  treatment — carrying the wordmark and a "proof backed" tag, all mono
  uppercase.
- Square corners everywhere (`border-radius: 0`).
- Dotted connectors between rows (the `.ld-proof-trail` treatment).
- Mono uppercase footer: **"No proof, no claim."** plus support/unsubscribe.
- CTAs: ink button, square corners, signal-green hard shadow, mono uppercase,
  ≥44px tap height.

## 4. Proof-strip parity per change row

Each top-move row mirrors the landing proof strip:

- **Honesty stamp** — "Live" (green, fresh stored evidence), "On record"
  (ink, older stored evidence), "Check-spotted" (flagged for review),
  "Evidence unavailable" (nothing attached). The Live/On-record split reuses
  the landing page's freshness window idea: evidence captured within
  `EMAIL_PROOF_FRESH_DAYS` (3 days) of the period end is Live, older stored
  evidence is On record. Only facts the item already carries are used — never
  an invented status.
- **Freshness label** — relative age ("2 days ago") next to the ISO-formatted
  mono timestamp.
- **Source link** — when the item stores a public source URL
  (`sourceUrl`/`landingPageUrl`/`proofUrl`/`websiteUrl`/`canonicalUrl`), the
  row shows a linked "Source:" line; every row keeps its deep link to the
  evidence row.
- **Screenshot thumbnails** — before/after pairs (creative or landing-page
  evidence) render responsive 50% cells; missing pairs render the explicit
  pending copy, never a broken image.
- **"No proof, no claim."** foot echoes the landing proof strip's closing
  line, and the "Source coverage: verified evidence means…" honest-labelling
  copy is preserved in body and plain text.

## 5. Mobile-first (accept criterion 4)

Single-column everywhere. Images are fluid (`width:100%` + `max-width`,
table cells at 50%), the shell is `max-width:600px` with small-viewport
padding, no fixed-width element exceeds ~300px, so the brief fits at 320px
with no horizontal scroll. Buttons carry `padding:13px 20px` ≈ 44px+ tap
height.

## 6. Client testing — the Litmus/Email on Acid equivalent

Paid Litmus access is not available on this project, so testing targets the
constraints that Gmail / Outlook / Apple Mail / Yahoo actually enforce, and
the render gallery is the human-inspectable proof:

- **Gmail**: no `<head>` styles or classes — every rule is inline; no web
  font loading — the display/mono stacks declare their fallbacks; no
  `prefers-color-scheme` — surfaces are forced light with explicit colours
  (already the shell's invariant, asserted by `email-template.server.test.ts`).
- **Outlook (Word)**: table-based structure, `role="presentation"` tables,
  square corners and border+background carry the case-file look even where
  `box-shadow` is dropped; fluid widths avoid the Word renderer's overflow.
- **Apple Mail / Yahoo**: `box-shadow` and the hard-offset shadows render;
  mono/display stacks render where the fonts are installed.
- **Rendering proof**: `tests/email-render-gallery.test.ts` builds every
  template with realistic fixtures, wraps it in the real case-file shell, and
  writes `/tmp/email-gallery/index.html` for human review. The new
  `tests/email-case-file-design.test.ts` locks the issue's verify/termination
  markers (`ld-proof-strip`, `case-file`, `signal-green`), the token values,
  the Live/On-record stamps, and the plain-text honesty lines so the design
  system cannot silently drift back.

## 7. Plain-text fallback (accept criterion 5)

Every template keeps its full plain-text twin carrying the same honest
labelling: per-row `Evidence status: Live / On record / …`, `Source status`,
`Source type`, timestamps, and the "No proof, no claim." foot. Nothing is
claimed in HTML that the text version omits.

## 8. Files touched

- `app/lib/email-template.server.ts` — case-file tokens, `theme` support in
  the shell, stamps, proof-trail, CTA/display/meta styles.
- `app/lib/digest-email.server.ts` — all five digest variants + shared blocks
  (retention, accountability, strategy, trends, thumbnails, evidence cards,
  per-row stamps/source links), text parity.
- `app/lib/delivery.server.ts` — instant alerts, alert diff/creative,
  presence digest, send-site theme wiring.
- `app/lib/delivery-email-core.server.ts` — `theme`/`preheader` passthrough.
- `app/lib/monthly-recap.server.ts` — recap restyle + theme + text parity.
- `tests/email-template.server.test.ts`, `tests/email-render-gallery.test.ts`,
  `tests/delivery.server.test.ts` — assertions moved to the new palette.
- `tests/email-case-file-design.test.ts` — new regression lock.