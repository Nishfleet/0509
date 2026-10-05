# Launch video — 0509.io

A 75-second launch video for **0509.io**, built with [HyperFrames](https://github.com/heygen-com/hyperframes)
(Apache-2.0), rendered to one 1920×1080 MP4.

|                |                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------- |
| Script         | [`SCRIPT.md`](./SCRIPT.md)                                                               |
| Shot-by-shot   | [`STORYBOARD.md`](./STORYBOARD.md)                                                       |
| Rendered video | attached to the draft GitHub release **`launch-video`** in this repo                     |
| Source         | `index.html` + `compositions/01…07.html` (one file per act)                              |
| Build          | `npx hyperframes@0.8.133 check` then `npx hyperframes@0.8.133 render`                    |
| Output         | `renders/launch-video_<timestamp>.mp4` — 1920×1080, 30 fps, 75.0 s, h264, no audio track |

## How to re-render

```bash
cd marketing/launch-video
npx -y hyperframes@0.8.133 check     # lint, runtime, motion — must be 0 errors
npx -y hyperframes@0.8.133 render    # ~1 minute; writes renders/launch-video_<ts>.mp4
```

The VPS has no GPU, so the render falls back to software (`llvmpipe`). One render at
a time, as the issue asks.

## Music: there is none, on purpose

**The video has no music track.** The issue allows shipping without music when no
commercially-licensed track can be cited. No track was found that (a) permits
commercial use, (b) does not need a paid licence, and (c) can be cited with a
licence URL here. A paid track or a licence-free download without a citable licence
were both rejected, so the video ships silent. Sound design would be a follow-up,
not a licence risk.

## Reference videos watched

Three product-launch videos were studied for pacing and structure. They are **not in
git** — they were downloaded to `/tmp/refs/` for this run only.

| Reference                      | Length | Source                                                                                                 | What was taken from it                                                    |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| HeyGen × Stripe product launch | 38.7 s | <https://assets.hyperframes.dev/showcase/stripe-product-launch.mp4>                                    | Product name on screen early, one real screen per idea, end on the domain |
| Website → video                | 41.8 s | <https://static.heygen.ai/hyperframes-oss/docs/images/showcase/launch-website-to-hyperframes-v1-s.mp4> | The "one URL in, video out" act shape used in ACT 2                       |
| HyperFrames launch             | 49.8 s | <https://static.heygen.ai/hyperframes-oss/docs/images/showcase/launch-hyperframes-launch-v1-s.mp4>     | Numbered how-it-works steps (ACT 3)                                       |

YouTube was not used. `yt-dlp` is blocked there by a bot check, and these three
HyperFrames showcase files are closer to the job anyway. Their source projects are
public at `github.com/heygen-com/hyperframes-launches`.

## Every claim in the video, with its source

The video contains no invented numbers, no invented customers and no invented
quotes. Every line traces to one of these:

| Claim in the video                                                                                           | Source                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "For founders, brands and creators"                                                                          | `app/components/landing/hero.tsx:93` — live landing page                                                                                                                                                                                                                                           |
| "Know where you stand. And who's gaining on you."                                                            | `app/components/landing/hero.tsx:95` — live landing page                                                                                                                                                                                                                                           |
| "One box to fill in. About a minute to see who's gaining on you."                                            | `app/components/landing/hero.tsx:114` — live landing page                                                                                                                                                                                                                                          |
| "One brief, every Monday. The three things worth knowing about your competitors, and the proof behind each." | `app/components/landing/how-it-works.tsx:17-19` — step 03 body                                                                                                                                                                                                                                     |
| ACT 1 screenshot = the live top of 0509.io                                                                   | rendered from this repo on `127.0.0.1:5199`, route `/design/landing` (the local build of the public landing page)                                                                                                                                                                                  |
| ACT 2 screenshot = the sign-in box as shipped                                                                | rendered from this repo on `127.0.0.1:5199`, route `/login`                                                                                                                                                                                                                                        |
| ACT 2 typed box = `yourbrand.com` typing on                                                                  | a box drawn for this video (`.a2-box` in `compositions/02-one-box.html`), typing the placeholder the real sign-up box asks for (`app/components/landing/hero.tsx:103-104`). The typing does NOT happen inside the capture                                                                          |
| "One box to fill in." / "Your website address or your social username."                                      | `app/components/landing/hero.tsx:103-104` — the sign-up box's own label and placeholder                                                                                                                                                                                                            |
| "We email you a link. Tap it and you're in. There is no password."                                           | on-screen in the captured `/login` screen                                                                                                                                                                                                                                                          |
| ACT 3 steps 01 / 02 / 03 and the opening sentences of their bodies                                           | `app/components/landing/how-it-works.tsx:5-19` — word for word                                                                                                                                                                                                                                     |
| "Not a news feed. A mark."                                                                                   | copy for this video, describing the change-alert format shown in ACT 4                                                                                                                                                                                                                             |
| "Annual plan — 20% off → 30% off"                                                                            | `docs/design-directions/a-final/landing.html:16-20` — ticker item "Bramble annual 20% &rarr; 30%"                                                                                                                                                                                                  |
| "What changed … When we saw it … The proof …"                                                                | on-screen column headers in `docs/design-directions/a-final/alerts-desktop-1440.png`                                                                                                                                                                                                               |
| ACT 4 screenshot = the alerts screen                                                                         | `docs/design-directions/a-final/alerts-desktop-1440.png`, committed in this repo                                                                                                                                                                                                                   |
| ACT 5 screenshot = the home screen                                                                           | `docs/design-directions/a-final/home-desktop-1440.png`, committed in this repo                                                                                                                                                                                                                     |
| ACT 5 index lines = `Read this first` / `Where you’ve stood` / `Where everyone stands`                       | the three h2s of `docs/design-directions/a-final/home.html` at `:31`, `:93`, `:139`, in the order the screen shows them                                                                                                                                                                            |
| "Home screen, this week's standing"                                                                          | caption over a real keyframe; describes the picture under it                                                                                                                                                                                                                                       |
| Scout €10 / Starter €46 / Agency €136 per month                                                              | `app/lib/billing/plans.ts:6-7`, `:21-22`, `:36-37` — as published on `/pricing`                                                                                                                                                                                                                    |
| "Up to 5 / 15 / 50 competitors."                                                                             | `app/lib/billing/plans.ts` `limits.competitors` at `:9`, `:24`, `:39`                                                                                                                                                                                                                              |
| "0509.io"                                                                                                    | the site's own domain                                                                                                                                                                                                                                                                              |
| Type = Bricolage Grotesque, Instrument Sans, IBM Plex Mono                                                   | self-hosted from this repo's `public/fonts/` (OFL-1.1 families) into `assets/fonts/`                                                                                                                                                                                                               |
| Colour = the product's brand tokens                                                                          | `app/app.css:85-96`: `--bone #f4f1e8`, `--ink #0e0d0a`, `--green #16c47f`, `--green-ink #064d31`, `--ink-soft #55524a`, `--line #ddd6c6`. `--green` marks the dark acts and `--green-ink` is green text on bone, following the one-accent rule at `docs/design-directions/a-final/style.css:70-72` |
| Colour, one exception                                                                                        | `--ink-faint #67635c` stands in for the app's `#8e8878`, which is 3.1:1 on bone; the 16-18px labels that use it need 4.5:1                                                                                                                                                                         |
| Dark-act greys (`#8c8a80`, `#b9b5aa`, `#2a2823`, `#171512`, `#3d3a33` …)                                     | chosen for this video to sit between the two real tokens. They are not repository values and are not claimed to be                                                                                                                                                                                 |
| The five `assets/fonts/*.woff2` files                                                                        | byte-identical to the five in this repo's `public/fonts/` (md5 checked), so the type really is the product's own                                                                                                                                                                                   |

The screenshots in `assets/` are real captures. Two are screenshots of this repo's
own pages served locally; three are design keyframes committed in
`docs/design-directions/a-final/`. No screen was invented and no number was invented.
One element is drawn rather than captured: the input box in ACT 2 that types
`yourbrand.com`. Everything else on screen is a capture, a font, a token or a line
quoted in the table above.

## The fonts, the licence, and the one network tag

**Type.** The three families are Bricolage Grotesque, Instrument Sans and IBM Plex
Mono, each licensed under the SIL Open Font License 1.1. The OFL permits commercial
use, so a render that ships with them is covered. This repo stores the five `.woff2`
files in `public/fonts/` with no licence text beside them, so the video copies the
woff2s into `assets/fonts/` and says here, rather than in the folder, where the
licence comes from.

**Text characters.** `assets/fonts/bricolage-hero.woff2` is not one of them, and none
of the seven compositions uses it. The film's glyph set is what the seven
compositions set, so every glyph a viewer sees is covered by the five files in the
folder.

**The one external call.** `index.html` loads gsap 3.14.2 from a pinned jsDelivr URL
and carries an `integrity="sha384-…"` hash over it. That hash is the asset's own
sha384, read back from jsDelivr's metadata endpoint at
`https://data.jsdelivr.com/v1/packages/npm/gsap@3.14.2?structure=flat` for
`dist/gsap.min.js` (base64 of the sha256: `wXS/zlOnKUGNV6ithiXnJHx5OiL++OKFHjz6PenNgoA=`).
Nothing else on the page reaches the network, so a render with no network access
fails rather than silently changing the film.
