# Lane evidence — claim/issue-3880

Issue Nishfleet/0509#3880 · unit pi-issue-0509-3880 · scout run 2026-09-21 ~06:59–07:1x UTC, VPS datacenter IP, curl.

Deliverable: `docs/REBUILD-CREATOR-SOURCES.md`. Scope note: the packet's FILES-IN-SCOPE block names `docs/REBUILD-CREATOR-SOURCES.md` while its trailing Deliverable line says `docs/REBUILD-CREATORS.md`; the scope block's "Anything outside these paths is a rejection" wins — wrote the former only.

## Live probe log (verbatim signals)

| Probe | Result |
|---|---|
| `GET instagram.com/gymshark/` (browser UA) | HTTP 200, 626 KB — login shell, no bio/follower fields |
| `GET instagram.com/api/v1/users/web_profile_info?username=gymshark` `X-IG-App-ID: 936619743392459` | HTTP 401 `{"require_login":true,"status":"fail"}` |
| `GET instagram.com/p/BsOGulcndj-/embed/captioned/` | HTTP 200 — login-only content |
| `GET tiktok.com/@gymshark` (browser UA) | HTTP 200, 370 KB — `__UNIVERSAL_DATA_FOR_REHYDRATION__` contains `"uniqueId":"gymshark","followerCount":6700000` |
| `GET tiktok.com/oembed?url=…/@scout2015/video/6718335390845095173` | HTTP 200 `{"type":"video","author_name":"Scout, Suki & Stella"…}` (a different sampled video returned 400 — per-video gaps) |
| `GET threads.net/@zuck` → `threads.com/@zuck` | 301 → HTTP 200 generic shell; zero `zuck`/`follower_count` occurrences — logged-out wall |
| `GET newsletter.pragmaticengineer.com/api/v1/archive?limit=5` | HTTP 200 JSON — `"id":215854309,"title":"AI Skills with Matt Pocock"` |
| `GET public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=bsky.app` | HTTP 200 `{"did":"did:plc:z72i7hdynmk6r22z27h6tvur","handle":"bsky.app"}` |
| `GET public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=bsky.app&limit=2` | HTTP 200 — real post `at://did:plc:zbrhmanjs62oyqywjwdazxz3/…/3mvta262ufs27` (kenjennings.bsky.social) |
| `GET public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=cloudflare` | HTTP 403 HTML block (unchanged from REBUILD-MENTIONS) |
| Jetstream `jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post&compress=false` (WS upgrade) | 101 upgrade → live plaintext commit frames, `time_us:1789974205689979` |
| `POST gql.twitch.tv/gql` `Client-ID: kimne78kx3ncx6brgo4mv6wki5h1ko` | HTTP 200 — `ninja` profile: id 19571641, title "WEEK 1 NFL RECAP…", game "Just Chatting" |
| `GET patreon.com/kurzgesagt` | HTTP 403, 5.7 KB block page |
| `GET graphtreon.com/creator/kurzgesagt` | HTTP 200, 186 KB — `earningsSeriesData = [[1427155200000,…` embedded |
| `GET linkedin.com/company/cloudflare/` logged-out | HTTP 200 — `og:description` "1,187,614 followers", `pageKey: d_org_guest_company_overview` |
| `GET linkedin.com/in/satyanadella/` | HTTP 999 authwall |
| `GET pinterest.com/gymshark/feed.rss` | HTTP 200 RSS — channel "Gymshark" |
| `GET youtube.com/feeds/videos.xml?channel_id=UCX6OQ3DkcsbYNE6H8uQQuVA` | HTTP 200 Atom, `yt:video:` entries |

X not re-probed — REBUILD-MENTIONS live proof (2026-09-20, HTTP 200, 3 real posts via SuperGrok `x_search`) stands; the call meters the prepaid seat.

## Pricing fetches (webfetch, 2026-09-21)

apify.com/pricing + apify.com/apify/instagram-scraper · scrapecreators.com + llms.txt · brightdata.com/products/web-scraper/pricing · ensembledata.com/pricing · developers.cloudflare.com/browser-rendering/platform/pricing/ · docs.x.com/x-api/getting-started/pricing — figures cited inline in the deliverable with links.

## Failed/absent commands

- `memoryctl context` → `No such file or directory` (not installed at `~/.local/bin/memoryctl`) — memory loop skipped, flagged.
- `scrapecreators.com/pricing` → HTTP 404; pricing recovered from homepage `#pricing` anchor (packs: $47/25k, $497/500k).
- `python3 -c 'import websockets'` → ImportError; Jetstream probed via raw curl WS upgrade instead — succeeded.
