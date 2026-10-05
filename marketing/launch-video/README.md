# Launch video — 0509.io

A 75-second launch video for **0509.io**, built with [HyperFrames](https://github.com/heygen-com/hyperframes)
(Apache-2.0), rendered to one 1920×1080 MP4.

| | |
|---|---|
| Script | [`SCRIPT.md`](./SCRIPT.md) |
| Shot-by-shot | [`STORYBOARD.md`](./STORYBOARD.md) |
| Rendered video | attached to the draft GitHub release **`launch-video`** in this repo |
| Source | `index.html` + `compositions/01…07.html` (one file per act) |
| Build | `npx hyperframes@0.8.133 check` then `npx hyperframes@0.8.133 render` |
| Output | `renders/launch-video_<timestamp>.mp4` — 1920×1080, 30 fps, 75.0 s, h264, no audio track |

## How to re-render

```bash
cd marketing/launch-video
HOME="$HOME" npx -y hyperframes@0.8.133 check     # lint, runtime, motion — must be 0 errors
HOME="$HOME" npx -y hyperframes@0.8.133 render    # ~1 minute; writes renders/launch-video_<ts>.mp4
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

| Reference | Length | Source | What was taken from it |
|---|---|---|---|
| HeyGen × Stripe product launch | 38.7 s | <https://assets.hyperframes.dev/showcase/stripe-product-launch.mp4> | Product name on screen early, one real screen per idea, end on the domain |
| Website → video | 41.8 s | <https://static.heygen.ai/hyperframes-oss/docs/images/showcase/launch-website-to-hyperframes-v1-s.mp4> | The "one URL in, video out" act shape used in ACT 2 |
| HyperFrames launch | 49.8 s | <https://static.heygen.ai/hyperframes-oss/docs/images/showcase/launch-hyperframes-launch-v1-s.mp4> | Numbered how-it-works steps (ACT 3) |

YouTube was not used. `yt-dlp` is blocked there by a bot check, and these three
HyperFrames showcase files are closer to the job anyway. Their source projects are
public at `github.com/heygen-com/hyperframes-launches`.

## Every claim in the video, with its source

The video contains no invented numbers, no invented customers and no invented
quotes. Every line traces to one of these:

| Claim in the video | Source |
|---|---|
| "For founders, brands and creators" | `app/components/landing/hero.tsx:93` — live landing page |
| "Know where you stand. And who's gaining on you." | `app/components/landing/hero.tsx:95` — live landing page |
| "One box to fill in. About a minute to see who's gaining on you." | `app/components/landing/hero.tsx:114` — live landing page |
| "One brief, every Monday. The three things worth knowing about your competitors, and the proof behind each." | `app/components/landing/how-it-works.tsx:17-19` — step 03 body |
| ACT 1 screenshot = the live top of 0509.io | rendered from this repo on `127.0.0.1:5199`, route `/design/landing` (the local build of the public landing page) |
| ACT 2 screenshot = the sign-in box as shipped | rendered from this repo on `127.0.0.1:5199`, route `/login` |
| "One box to fill in." / "Your website address or your social username." | `app/components/landing/hero.tsx:103-104` — the sign-up box's own label and placeholder |
| "We email you a link. Tap it and you're in. There is no password." | on-screen in the captured `/login` screen |
| ACT 3 steps 01 / 02 / 03 and their bodies | `app/components/landing/how-it-works.tsx:5-19` — verbatim |
| "Not a news feed. A mark." | copy for this video, describing the change-alert format shown in ACT 4 |
| "Annual plan — 20% off → 30% off" | `docs/design-directions/a-final/landing.html:16-20` — ticker item "Bramble annual 20% &rarr; 30%" |
| "What changed … When we saw it … The proof …" | on-screen column headers in `docs/design-directions/a-final/alerts-desktop-1440.png` |
| ACT 4 screenshot = the alerts screen | `docs/design-directions/a-final/alerts-desktop-1440.png`, committed in this repo |
| ACT 5 screenshot = the home screen | `docs/design-directions/a-final/home-desktop-1440.png`, committed in this repo |
| "Where you stood" / "Where everyone stands" / "The three things worth knowing" | `docs/design-directions/a-final/home.html` — the three home h2s |
| "Home screen, this week's standing" | caption over a real keyframe; describes the picture under it |
| Scout €10 / Starter €46 / Agency €136 per month | `app/lib/billing/plans.ts:6-7`, `:21-22`, `:36-37` — as published on `/pricing` |
| "One brand, watched weekly." / "More competitors, more sources." / "For the ones who watch many." | `app/lib/billing/plans.ts` — plan descriptions |
| "0509.io" | the site's own domain |
| Type and colour | the product's own `public/fonts/` and its bone / ink / green brand tokens |

The screenshots in `assets/` are real captures. Two are screenshots of this repo's
own pages served locally; three are design keyframes committed in
`docs/design-directions/a-final/`. No UI in the video was drawn from scratch, and no
screen was invented.
