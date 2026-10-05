# Third-party code notices

## `app/lib/data/retries.server.ts` — `tryWhile` and `jitterBackoff`

Copied from [`@cloudflare/actors`](https://github.com/cloudflare/actors)
`packages/core/src/retries.ts` at commit
[`9ba112503132ddf6b5cef37ff145e7a2dd5ffbfc`](https://github.com/cloudflare/actors/blob/9ba112503132ddf6b5cef37ff145e7a2dd5ffbfc/packages/core/src/retries.ts),
the copy path the D1 docs name
(<https://developers.cloudflare.com/d1/best-practices/retry-queries/>: "You can
use libraries abstracting that already like `@cloudflare/actors`, or copy the
retry logic in your own code directly"). The copy is comment-free because this
repo bans comments under `app/` (eslint `no-comments/disallowComments`);
`shouldRetryD1` in the same module is this repo's copy of the documented
`shouldRetry` example on that page. Two trims keep the copy inside this repo's lint gates, both
behaviour-preserving for every call in this repo: the upstream `options`
parameter (`baseDelayMs`/`maxDelayMs`/`verbose`) is dropped and the upstream
defaults (100 ms base, 3000 ms cap) are hard-coded, and `jitterBackoff` is
module-private instead of exported. Unchanged from the upstream source: the
retry loop, the full-jitter backoff and the MIT licence below.

```
MIT License

Copyright (c) 2025 Brayden Wilmoth

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
