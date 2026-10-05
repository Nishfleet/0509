# Storyboard — 0509.io launch video

1920×1080 · 30 fps · 75.0 s · 7 acts · one HTML file per act.
Root background `#0e0d0a` (the product's `--ink`). Brand tokens: `--bone #f4f1e8`,
`--ink #0e0d0a`, `--accent #16c47f`, `--ink-soft #4a4740`, `--ink-faint #a8a49a`, `--line #d9d4c6`.

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

| Element    | Time | Text / picture                                                                              |
| ---------- | ---- | ------------------------------------------------------------------------------------------- |
| Label      | 0.00 | `STEP ONE`                                                                                  |
| Headline   | 0.15 | `One box` / `to fill in.`                                                                   |
| Body       | 0.35 | `Your website address or your social username. That is the whole setup.`                    |
| Screenshot | 0.60 | `assets/app-login-1440x900.png` — the sign-in box as shipped, with `yourbrand.com` typed in |
| Caption    | 1.00 | `THE SIGN-UP BOX, AS SHIPPED`                                                               |

Background ink. The typed `yourbrand.com` is staged inside the real captured screen
— the picture shows the shipped product, not a mock-up.

---

### ACT 3 — HOW IT WORKS · 0:21.00 – 0:39.00 · `compositions/03-how-it-works.html`

| Element       | Time  | Text                                                                                                    |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| Label         | 0.0   | `HOW IT WORKS`                                                                                          |
| Step 01 title | 0.30  | `Enter your website or social username`                                                                 |
| Step 01 body  | 0.50  | `We read it and fill in your details while you watch: what you sell, who it is for, the words you use.` |
| Step 02 title | 5.30  | `Meet who you're up against`                                                                            |
| Step 02 body  | 5.50  | `We find your competitors and switch them on for you. Each one has one switch.`                         |
| Step 03 title | 10.30 | `Read one email on Monday`                                                                              |
| Step 03 body  | 10.50 | `Where you stand this week, the three things worth knowing, and the proof behind each.`                 |

Background bone. Steps 01–03 and their bodies are verbatim from
`app/components/landing/how-it-works.tsx:5-19`.

---

### ACT 4 — THE MARK · 0:39.00 – 0:52.00 · `compositions/04-the-mark.html`

| Element        | Time | Text / picture                                            |
| -------------- | ---- | --------------------------------------------------------- |
| Label          | 0.0  | `EVERY CHANGE, IN ONE LINE`                               |
| Headline       | 0.2  | `Not a news feed. A mark.`                                |
| Before → after | 0.8  | `Annual plan — 20% off` → `Annual plan — 30% off`         |
| Screenshot     | 2.0  | `assets/keyframe-alerts-1440x900.png` — the alerts screen |
| Caption        | 2.2  | `SCREENSHOT BEHIND THE CHANGE`                            |
| Annotations    | 3.0  | `What changed` / `When we saw it` / `The proof`           |

Background ink. The 20% → 30% change is the ticker item from
`docs/design-directions/a-final/landing.html:16-20`, drawn as a before/after so the
"one line per change" idea is visible rather than asserted.

---

### ACT 5 — THE MONDAY BRIEF · 0:52.00 – 1:02.00 · `compositions/05-monday-brief.html`

| Element    | Time | Text / picture                                                                          |
| ---------- | ---- | --------------------------------------------------------------------------------------- |
| Label      | 0.0  | `WHAT LANDS IN YOUR INBOX`                                                              |
| Headline   | 0.2  | `one email` / `on Monday.`                                                              |
| Body       | 0.5  | `Where you stand this week, the three things worth knowing, and the proof behind each.` |
| Screenshot | 1.2  | `assets/keyframe-home-1440x900.png` — the home screen                                   |
| Caption    | 2.0  | `HOME SCREEN, THIS WEEK'S STANDING`                                                     |
| Index      | 2.4  | `01 Where you stood` / `02 Where everyone stands` / `03 The three things worth knowing` |

Background bone. The index lines are the three real h2s of the committed home
keyframe.

---

### ACT 6 — THE PRICE · 1:02.00 – 1:08.00 · `compositions/06-price.html`

| Element  | Time | Text                                                          |
| -------- | ---- | ------------------------------------------------------------- |
| Label    | 0.0  | `WHAT IT COSTS`                                               |
| Headline | 0.1  | `Three plans. One is enough.`                                 |
| Plan 1   | 0.4  | `SCOUT` · `€10 / month` · `One brand, watched weekly.`        |
| Plan 2   | 0.4  | `STARTER` · `€46 / month` · `More competitors, more sources.` |
| Plan 3   | 0.4  | `AGENCY` · `€136 / month` · `For the ones who watch many.`    |
| Footer   | 0.8  | `PRICING AS PUBLISHED ON THE APP'S PRICING PAGE`              |

Background ink. Prices are `monthlyPriceEur` from `app/lib/billing/plans.ts`.

---

### ACT 7 — THE CLOSE · 1:08.00 – 1:15.00 · `compositions/07-close.html`

| Element  | Time | Text                                          |
| -------- | ---- | --------------------------------------------- |
| Wordmark | 0.0  | `05 09` (green `09`)                          |
| Domain   | 0.6  | `0509.IO`                                     |
| CTA      | 1.2  | `One box to fill in.`                         |
| CTA      | 1.8  | `About a minute to see who's gaining on you.` |

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
