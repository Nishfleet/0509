import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  route("login", "routes/login.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("app", "routes/app.home.tsx"),
  route("app/competitors", "routes/app.competitors.tsx"),
  route("app/competitors/:entityId", "routes/app.competitor.tsx"),
  route("app/alerts", "routes/app.alerts.tsx"),
  route("app/settings", "routes/app.settings.tsx", [
    route("card", "routes/settings.card.tsx"),
  ]),
  route("s/:slug", "routes/s.$slug.tsx"),
  route("api/health", "routes/api.health.ts"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("onboarding", "routes/onboarding._index.tsx"),
  route("onboarding/identity", "routes/onboarding.identity.tsx"),
  route("*", "routes/unmatched.tsx"),
  route("design/brand-chips", "routes/design.brand-chips.tsx"),
] satisfies RouteConfig;
