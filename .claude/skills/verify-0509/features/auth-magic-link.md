# Auth — magic link

Routes: `app/routes/auth.login.tsx`, `app/routes/auth.signup.tsx`, shared form in
`app/components/auth-form.tsx`. Aliases `/login` and `/signup` land on the same pages.

## How users reach it

`Create account` or `Sign in` from any public page, or a `requireSession` redirect out of
`/app/*` carrying `?redirectTo=<path>`.

## How to drive it

1. `GET /auth/login` — `<h1>` reads `Return to the changes your team is watching.` and the card
   `<h2>` reads `Get a secure sign-in link.`
2. The form is `<Form method="post">` with hidden `mode` and `redirectTo`, and one visible
   field labelled `Email` (`name="email"`, `type="email"`, `required`, placeholder
   `you@company.com`). Signup adds a `Name` field (`name="name"`, `required`, placeholder
   `Your name`).
3. Submit button reads `Send sign-in link` on login and `Send setup link` on signup; both show
   `Sending…` while the submission is pending.
4. Submit a valid address → redirect to `/auth/login?sent=1&email=<email>&redirectTo=/app`, and
   the card switches to `<h2>Check your email` with a `role="status"` notice
   `Link sent to <email>` and a `Resend link` button.
5. Submit a malformed address → redirect to
   `/auth/login?error=email_invalid&redirectTo=%2Fapp&email=<email>`. Other codes the route
   emits: `better_auth_not_configured`, `request_invalid`, `send_failed`.

```bash
curl -fsS 'http://127.0.0.1:4179/auth/login' | grep -c 'Get a secure sign-in link.'
curl -s -o /dev/null -w '%{redirect_url}\n' -X POST \
  -d 'mode=login&redirectTo=/app&email=not-an-email' \
  'http://127.0.0.1:4179/auth/login'
```

## What proves success

- `/auth/login` and `/auth/signup` return 200 with the headings and fields above.
- A valid email POST 302s to a URL carrying `sent=1`.
- An invalid email POST 302s to a URL carrying `error=email_invalid`.

## Honesty note — sign-in cannot complete locally

The magic link is delivered by email through the Cloudflare `send_email` binding.
`wrangler.e2e.jsonc` declares no email binding and the app never prints the link to the console,
so no local drive can finish a sign-in. Local proof stops at "the form renders, and it routes
correctly on valid and invalid input".

`BETTER_AUTH_SECRET` and `AUTH_PROVIDER=better-auth` are set by the `e2e:serve:local` script,
so the form is active rather than showing the not-configured error. OAuth buttons render only
when provider credentials exist — none do locally.
