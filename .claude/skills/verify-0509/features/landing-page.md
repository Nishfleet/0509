# Landing page — `/`

The anonymous marketing home. Route: `app/routes/marketing.tsx`.

## How users reach it

Open `http://127.0.0.1:4179/` in a browser, or follow the brand wordmark from any public page.
No account, no session.

## How to drive it

1. `GET /` — expect 200.
2. Read the hero heading. It is one `<h1 class="ld-wall">` split across spans, so match it as a
   pattern: `/They cut.*price/i`.
3. The hero form is `<Form method="get" action="/search" aria-label="Public search preview">`:
   - text input, `aria-label="Competitor website"`, `name="website"`,
     placeholder `paste-their-website.com…`
   - submit button reading `Preview available ads →`
   Fill the input with `nykaa.com` and submit — the browser lands on `/search?website=nykaa.com`.
4. The `Try with Nykaa` link goes to
   `/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com` (exact string).
   `Review sample brief` next to it is an in-page jump to `#demo`.
5. In-page anchors that must exist: `#demo`, `#platform`, `#signal`, `#pricing`, `#faq`.

```bash
curl -fsS 'http://127.0.0.1:4179/' -o /tmp/verify-0509/home.html
grep -c 'Public search preview' /tmp/verify-0509/home.html
grep -c '/search?query=nykaa&amp;mode=advertiser&amp;website=https%3A%2F%2Fnykaa.com' /tmp/verify-0509/home.html
```

## What proves success

- HTTP 200.
- Hero heading matching `/They cut.*price/i` is visible.
- The `role="note"` paragraph is visible and its bolded lead reads exactly `No account needed.`
- `Try with Nykaa` carries the exact href above.
- Both the `Competitor website` input and the `Preview available ads →` button are present and
  reachable above the fold.

## Local honesty note

Pricing is filled in by a client-side `fetch("/api/pricing-preview")`. With no Dodo credentials
locally the preview comes back unavailable, so the `Annual` billing toggle renders
`disabled` / `aria-disabled="true"` and the plan CTAs do not offer checkout. Local success must
NOT require a working monthly/annual choice.
