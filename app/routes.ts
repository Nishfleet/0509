import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  route("login", "routes/login.tsx"),
  route("app", "routes/app.home.tsx"),
  route("app/competitors", "routes/app.competitors.tsx"),
  route("app/competitors/:entityId", "routes/app.competitor.tsx"),
  route("app/alerts", "routes/app.alerts.tsx"),
  route("app/settings", "routes/app.settings.tsx"),
  route("api/health", "routes/api.health.ts"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("*", "routes/unmatched.tsx"),
] satisfies RouteConfig;
