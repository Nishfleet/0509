import {
  type RouteConfig,
  index,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/marketing.tsx"),
  route("search", "routes/search.tsx"),
  route("pricing-region", "routes/pricing-region.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/signup", "routes/auth.signup.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("api/delivery-status/:provider", "routes/api.delivery-status.$provider.ts"),
  route("api/health", "routes/api.health.ts"),
  route("app/onboard", "routes/app.onboard.tsx"),
  route("share/:token", "routes/share.$token.tsx"),
  route("export/:resourceType/:resourceId", "routes/export.$resourceType.$resourceId.tsx"),
  route("app", "routes/app-layout.tsx", [
    index("routes/app.dashboard.tsx"),
    route("collections", "routes/app.collections.tsx"),
    route("watchlists", "routes/app.watchlists.tsx"),
    route("digests", "routes/app.digests.tsx"),
    route("ops", "routes/app.ops.tsx"),
    route("reports/:id", "routes/app.reports.tsx"),
  ]),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
