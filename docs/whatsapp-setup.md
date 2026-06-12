# WhatsApp Delivery Setup (production)

Status 2026-06-12: code-side everything is ready and honest-gated (the UI
shows "not yet available" until the provider is configured). The webhook
verify token is already uploaded as a Worker secret; the remaining steps
need Nish's Meta Business account.

## What Nish does in Meta (business.facebook.com)

1. **WhatsApp Business Account**: Meta Business Suite → create/confirm a
   WhatsApp Business Account; complete business verification.
2. **Phone number**: add a dedicated number (cannot be one already on the
   WhatsApp app) → note the **Phone Number ID** from WhatsApp Manager.
3. **Meta App**: developers.facebook.com → app with the WhatsApp product →
   note the **App Secret** (App settings → Basic).
4. **Permanent token**: Business settings → System users → create system
   user → generate token with `whatsapp_business_messaging` +
   `whatsapp_business_management` → note the **Access Token**.
5. **Webhook** (App → WhatsApp → Configuration):
   - Callback URL: `https://0509.in/api/delivery-status/whatsapp`
   - Verify token: the value in `~/.config/whatsapp/0509-webhook-verify-token`
     (already uploaded as the Worker secret `WHATSAPP_WEBHOOK_VERIFY_TOKEN`)
   - Subscribe to the `messages` webhook field (delivery statuses).
6. **Message templates** (WhatsApp Manager → Message templates, language
   English, category Utility) — names must match the code exactly:

   | Template name | Params | Suggested body |
   |---|---|---|
   | `proof_digest_customer_v1` | 2 | Your Five to Nine brief for {{1}}: {{2}} competitor change(s) confirmed with proof. Open your dashboard for the evidence. |
   | `confirmed_instant_customer_v1` | 3 | {{1}}: {{2}}. See the evidence: {{3}} |
   | `provisional_customer_v1` | 2 | Possible change spotted at {{1}}. We're verifying and will confirm with proof. Details: {{2}} |
   | `proof_digest_internal_v1` | 2 | Internal digest {{1}}: {{2}} item(s). |
   | `internal_instant_v1` | 4 | {{1}}: {{2}} ({{3}}). {{4}} |

## Then (Claude can run these once the three values exist)

```bash
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
npx wrangler secret put WHATSAPP_APP_SECRET
npx wrangler secret put WHATSAPP_DELIVERY_ENABLED   # value: true
```

## Verification

- `/app/sources` → WhatsApp section shows "Provider: configured"; add a
  target — it sends a real `proof_digest_customer_v1` test template and
  only saves on success.
- `npm run canary:prod` — the `whatsapp_*` ops-readiness flags clear after
  the first delivered sends.

## Slack (no platform setup needed)

Slack delivery is customer-self-serve: each workspace pastes an incoming
webhook URL on `/app/sources`, which is live-tested on save. The canary's
`no_slack_delivery_target` flag clears as soon as the first target exists
— to clear it pre-launch, add a Slack webhook for Nish's own workspace as
a smoke target.
