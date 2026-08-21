# NEEDS-NISH — 2026-08-21 — 0509 (Five to Nine)

Scout timestamp: 2026-08-21T02:32:22.659Z
Product: 0509 (Five to Nine)
Source: var/scout/CANDIDATES-2026-08-21-0509.md

These items require Nish's decision/action on credentials, account authority,
billing, or external dashboards before the scout's survivors can proceed. They
are NOT dispatched to the worker fleet.

---

## 1. Dodo in-app plan-change / portal-cancellation live smoke [billing / credentials]

**Title:** Create one internal paid Scout or Starter subscription, then switch
Scout/Starter (or monthly/annual) once and confirm a signed Dodo webhook updates
the account, then confirm portal cancellation is available.

**Revenue impact:** HIGH if unresolved — billing correctness is the monetization
path. Checkout and signed-webhook plan/top-up grants already pass
`canary:billing`, but there is no live internal subscription, so in-app plan
change / portal cancellation is not yet proven against real provider behavior.

**Evidence:**
- `docs/ga-owner-actions.md:12` — status "REPO CONFIGURED / INTERNAL
  SUBSCRIPTION NEEDED (Nish/operator)": "Remote D1 aggregate check on 2026-07-02
  found no linked Scout/Starter subscriptions, so there is no safe internal
  target yet; create/complete one internal paid Scout or Starter subscription,
  then switch… confirm signed webhook updates the account, and separately confirm
  cancellation remains available in the Dodo portal."
- `docs/launch-readiness.md` — Gate A–C readiness `0/6`; one Nish-owned internal
  Dodo plan-change/cancellation smoke remaining.
- `docs/billing-sku-catalog.md` — `scout_/starter_/agency_` monthly+annual SKUs;
  provider product IDs map through `DODO_0509_PRODUCT_*` env; no monetary amounts
  hardcoded.

**Why Nish:** Creating an internal paid subscription touches Nish's Dodo account
and payment details; running the plan-change/cancellation smoke requires an
authenticated owner session. This is a credential/account decision only Nish can
make (consistent with the standing no-autonomous-spend rule).

## 2. Retired billing-provider dashboard cleanup [delete / external]

**Title:** In the retired billing provider's dashboard, disable/remove old
webhooks, subscriptions, payment links, and live products.

**Revenue impact:** Risk control (not new revenue). Repo/D1/Worker secrets
already have no retired-provider surface — the legacy migration
(`0060_remove_legacy_billing_provider.sql`) is applied — but the old provider's
dashboard could still send webhooks or expose obsolete payment links.

**Evidence:**
- `docs/ga-owner-actions.md:20` — status "EXTERNAL BLOCKED (Nish/operator)":
  "Repo runtime/schema is clean, provider-side cleanup still needed; disable/remove
  old webhooks, subscriptions, payment links, and live products in the retired
  provider dashboard."
- `docs/launch-readiness.md` — retired-provider dashboard cleanup listed among
  remaining owner gates.

**Why Nish:** Access to the retired provider's dashboard is an owner-managed
account; the cleanup is an external action only Nish can perform. Repo-side
cleanup is done.

## Not applicable

- **pricing:** Five-to-Nine pricing (Scout/Starter/Agency anchors + 8x annual +
  proof top-ups) is set and Dodo-localized; no pricing change surfaced in this
  audit beyond the already-scoped PR #808 published-price first-paint work, which
  stays a worker-shippable survivor.
- **legal:** no new legal/regulatory item beyond the existing review boundary.
- **brand:** no brand-blocking decision surfaced this cycle.