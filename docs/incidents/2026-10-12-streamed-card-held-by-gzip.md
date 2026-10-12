# 2026-10-12: the sign-up brand card was held back by document gzip

## What customers saw

A creator who typed a handle on the onboarding step saw the heading "Check your details" and then no fields, sometimes for the whole slow read. The card appeared only when every part of the page had finished. Domain sign-ups were slower to fill in, not stuck, because their pages close sooner.

## Start and end (UTC)

Start: 2026-10-12 08:14, when the deploy of #7350 (0509#7323) put `withCompressedDocument` in front of every document response. End: 2026-10-12 15:11, when the deploy of #7369 went live. The live J4 run at 13:41 failed at both widths; the live J4 run at 15:16 passed at both widths (50 s each, including sign-in).

## Root cause

`withCompressedDocument` piped the whole HTML body through `CompressionStream("gzip")`. A gzip stream keeps its last bytes until the stream closes, so a React Router response that streams a late part (the identity card `site` promise) delivered that part only when the response ended. The response ends when every deferred promise has settled, including the card's logo fetch, which has no limit of its own. The 28 second card limit (#7341) bounded the card, not the close of the page, so the limit could not help.

Proven: the J4 failure began after the 08:14 deploy and not before; the diff is the only change in that window to how a document is written out; after #7369 stopped gzipping documents that are still streaming, J4 passed at both widths. Not proven by a direct capture: no Worker logs were available for the failed run, and the local lane skips gzip on loopback, so the stall was not reproduced before the fix.

## How it was detected

J4 in the production e2e, dispatched after #7341 deployed. It failed waiting for the "edit name" row, 30 s after the heading showed.

## The fix

`handleRequest` asks whether the render is complete (`allReady` within one tick) and passes the answer to `withCompressedDocument`, which sends a still-streaming document plain. A document that finished rendering (privacy, terms, landing) still gzips.

## What stops a repeat

1. Code: a test in `tests/document-compression.test.ts` that a streaming body delivers its first chunk before the second exists.
2. Check: J4 in the production suite holds the first field to 30 s from submit, so a held-back stream fails it.
3. Open: the reviewer bot listed that `allReady` rejecting inside the tick would throw, that `status` is now read after the await, and that HEAD does not pass `settled`. None changes what a customer sees today; they are listed for a follow-up.
