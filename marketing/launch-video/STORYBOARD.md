# Storyboard — 0509.io launch video

1920×1080 · 30 fps · 75.0 s · 7 acts · one HTML file per act.
Root background `#0e0d0a` (the product's `--ink`). Colour comes from
`app/app.css:85-96`: `--bone #f4f1e8`, `--ink #0e0d0a`, `--green #16c47f`,
`--green-ink #064d31`, `--ink-soft #55524a`, `--line #ddd6c6`. The one exception is
`--ink-faint #67635c`, darkened from the app's `#8e8878` because that value is 3.1:1
on bone and the 16-18px labels here need 4.5:1.

Times are the `data-start` of each clip against its own act, so a time is read
against the act header, not against the film.

---

### ACT 1 — THE HOOK · 0:00.00 – 0:11.00 · `compositions/01-hero.html`

| Element        | Time | Text / picture                                                                                               |
| -------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| Green top rule | 0.0  | full-width 6px `--accent` bar                                                                                |
| Wordmark       | 0.05 | `05 09`                                                                                                      |
| Eyebrow        | 0.30 | `FOR FOUNDERS, BRANDS AND CREATORS`                                                                          |
| Headline       | 0.55 | `Know where you stand.` / `And who's gaining on you.` (98px, `gaining on you.` in green)                     |
| Screenshot     | 1.10 | `assets/app-landing-1440x900.png` — the live top of 0509.io                                                  |
| Caption        | 1.20 | `THE LIVE TOP OF 0509.IO`                                                                                    |
| Kicker         | 4.60 | `One brief, every Monday. The three things worth knowing about your competitors, and the proof behind each.` |

Background bone `--bone`. The first 5 seconds carry the audience (`For founders,
brands and creators`) and the job (`Know where you stand. And who's gaining on
you.`), as required.

---

### ACT 2 — ONE BOX · 0:11.00 – 0:21.00 · `compositions/02-one-box.html`

| Element    | Time | Text / picture                                                           |
| ---------- | ---- | ------------------------------------------------------------------------ |
| Label      | 0.10 | `STEP ONE`                                                               |
| Headline   | 0.00 | `One box` / `to fill in.`                                                |
| Screenshot | 0.60 | `assets/app-login-1440x900.png` — the sign-in box as shipped             |
| Caption    | 0.70 | `THE SIGN-UP BOX, AS SHIPPED`                                            |
| Body       | 3.90 | `Your website address or your social username. That is the whole setup.` |
| Typed box  | 4.30 | `yourbrand.com` types on, one character every 200ms                      |

Background ink. Two separate things sit on screen here, and neither stands in for
the other. On the right is the real captured sign-in screen
(`app-login-1440x900.png`). On the left is a drawn input box (`.a2-box`) that types
the placeholder text over 2.6s. The drawn box is the stub the product asks the user
to fill; the capture is the screen that boxes ships as. Both are real, but the
typing does not happen inside the capture.

---

### ACT 3 — HOW IT WORKS · 0:21.00 – 0:39.00 · `compositions/03-how-it-works.html`

| Element       | Time  | Text                                                                                                    |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| Label         | 0.10  | `HOW IT WORKS`                                                                                          |
| Step 01 title | 0.50  | `Enter your website or social username`                                                                 |
| Step 01 body  | 0.62  | `We read it and fill in your details while you watch: what you sell, who it is for, the words you use.` |
| Step 02 title | 6.50  | `Meet who you're up against`                                                                            |
| Step 02 body  | 6.62  | `We find your competitors and switch them on for you. Each one has one switch.`                         |
| Step 03 title | 12.50 | `Read one email on Monday`                                                                              |
| Step 03 body  | 12.62 | `Where you stand this week, the three things worth knowing, and the proof behind each.`                 |

Background bone. Steps 01–03 and the first sentences of their bodies are word
for word from `app/components/landing/how-it-works.tsx:5-19`. Each body on screen
stops at a sentence break; the rest of the line is the same body, read in ACT 5.

---

### ACT 4 — THE MARK · 0:39.00 – 0:52.00 · `compositions/04-the-mark.html`

| Element        | Time | Text / picture                                            |
| -------------- | ---- | --------------------------------------------------------- |
| Label          | 0.10 | `EVERY CHANGE, IN ONE LINE`                               |
| Headline       | 0.40 | `Not a news feed. A mark.`                                |
| Before → after | 1.20 | `Annual plan — 20% off` → `Annual plan — 30% off`         |
| Screenshot     | 2.40 | `assets/keyframe-alerts-1440x900.png` — the alerts screen |
| Caption        | 2.50 | `SCREENSHOT BEHIND THE CHANGE`                            |
| Annotations    | 2.60 | `What changed`                                            |
| Annotations    | 3.00 | `When we saw it`                                          |
| Annotations    | 3.40 | `The proof`                                               |

Background ink. The 20% → 30% change is the ticker item from
`docs/design-directions/a-final/landing.html:16-20`, drawn as a before/after so the
"one line per change" idea is visible rather than asserted.

---

### ACT 5 — THE MONDAY BRIEF · 0:52.00 – 1:02.00 · `compositions/05-monday-brief.html`

| Element    | Time | Text / picture                                                                          |
| ---------- | ---- | --------------------------------------------------------------------------------------- |
| Label      | 0.10 | `WHAT LANDS IN YOUR INBOX`                                                              |
| Headline   | 0.00 | `one email` / `on Monday.`                                                              |
| Body       | 2.40 | `Where you stand this week, the three things worth knowing, and the proof behind each.` |
| Screenshot | 0.80 | `assets/keyframe-home-1440x900.png` — the home screen                                   |
| Caption    | 0.90 | `HOME SCREEN, THIS WEEK'S STANDING`                                                     |
| Index      | 2.90 | `01 Read this first`                                                                    |
| Index      | 3.20 | `02 Where you've stood`                                                                 |
| Index      | 3.50 | `03 Where everyone stands`                                                              |

Background bone. The index lines are the three h2s of the home screen at
`docs/design-directions/a-final/home.html:31`, `:93` and `:139`, in the order that
screen shows them. The body is `how-it-works.tsx:18` minus its middle sentence, and
that middle sentence is the line under it.

---

### ACT 6 — THE PRICE · 1:02.00 – 1:08.00 · `compositions/06-price.html`

| Element  | Time | Text                                                          |
| -------- | ---- | ------------------------------------------------------------- |
| Label    | 0.10 | `WHAT IT COSTS`                                               |
| Headline | 0.00 | `Three plans. One is enough.`                                 |
| Plan 1   | 0.70 | `SCOUT` · `€10 / month` · `One brand, watched weekly.`        |
| Plan 2   | 0.85 | `STARTER` · `€46 / month` · `More competitors, more sources.` |
| Plan 3   | 1.00 | `AGENCY` · `€136 / month` · `For the ones who watch many.`    |
| Footer   | 1.20 | `PRICING AS PUBLISHED ON THE APP'S PRICING PAGE`              |

Background ink. Prices are `monthlyPriceEur` from `app/lib/billing/plans.ts:7`,
`:22` and `:37`. The three notes are the `limits.competitors` values on the same
plans, at `:9`, `:24` and `:39`.

---

### ACT 7 — THE CLOSE · 1:08.00 – 1:15.00 · `compositions/07-close.html`

| Element  | Time | Text                                                                  |
| -------- | ---- | --------------------------------------------------------------------- |
| Wordmark | 0.00 | `05 09` (green `09`)                                                  |
| Domain   | 0.00 | `0509.IO`                                                             |
| CTA      | 2.60 | `One box to fill in.` / `About a minute to see who's gaining on you.` |

Background bone. Ends on the domain and the one action a viewer can take.

---

## Assets used

| File                                  | What it is                                          | Source                                                          |
| ------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| `assets/app-landing-1440x900.png`     | landing page, 1440×900                              | captured from this repo served locally, route `/design/landing` |
| `assets/app-login-1440x900.png`       | sign-in page, 1440×900                              | captured from this repo served locally, route `/login`          |
| `assets/keyframe-alerts-1440x900.png` | alerts screen                                       | `docs/design-directions/a-final/alerts-desktop-1440.png`        |
| `assets/keyframe-home-1440x900.png`   | home screen                                         | `docs/design-directions/a-final/home-desktop-1440.png`          |
| `assets/fonts/*.woff2`                | Bricolage Grotesque, Instrument Sans, IBM Plex Mono | this repo's `public/fonts/`                                     |
