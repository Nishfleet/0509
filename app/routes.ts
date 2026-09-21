import {
  type RouteConfig,
  route,
} from "@react-router/dev/routes";

// REBUILD P2 C3 (#3862): every route off docs/REBUILD-KEEPLIST.md is deleted.
// What remains is the auth surface and the Dodo billing rail — the only
// routes whose import closure reads tables migrations/0001_init.sql creates.
// The kept engine modules under app/lib stay on disk unreferenced until P3
// rewires them against the fresh schema.
export default [
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/signup", "routes/auth.signup.tsx"),
  route("login", "routes/auth.login-alias.ts"),
  route("signup", "routes/auth.signup-alias.ts"),
  route("auth/logout", "routes/auth.logout.ts"),
  route("auth/better/magic-link", "routes/auth.better.magic-link.tsx"),
  route("auth/better/oauth", "routes/auth.better.oauth.ts"),
  route("auth/forgot-password", "routes/auth.forgot-password.tsx"),
  route("auth/reset-password", "routes/auth.reset-password.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("api/billing/dodo/checkout", "routes/api.billing.dodo.checkout.ts"),
  route("api/billing/dodo/cancel", "routes/api.billing.dodo.cancel.ts"),
  // api.billing.dodo.canary.ts stays on disk per the keep-list but is NOT
  // registered: its closure queries `watchlist`, which 0001_init.sql drops.
  // It goes dormant until P3 rewires the billing canary to the new schema.
  route("api/billing/dodo/portal", "routes/api.billing.dodo.portal.ts"),
  route("api/billing/dodo/plan-change", "routes/api.billing.dodo.plan-change.ts"),
  route("api/pricing-preview", "routes/api.pricing-preview.ts"),
  route("api/webhooks/dodo", "routes/api.webhooks.dodo.ts"),
] satisfies RouteConfig;
