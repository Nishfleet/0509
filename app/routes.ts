import { type RouteConfig, index, route } from "@react-router/dev/routes";

// The charter's four places, plus sign-in and the health endpoint.
// Nothing else is registered: a route that is not here cannot be reached.
export default [
  index("routes/landing.tsx"),
  route("login", "routes/login.tsx"),
  route("app", "routes/app.home.tsx"),
  route("app/competitors", "routes/app.competitors.tsx"),
  route("app/competitors/:entityId", "routes/app.competitor.tsx"),
  route("app/alerts", "routes/app.alerts.tsx"),
  route("app/settings", "routes/app.settings.tsx"),
  route("api/health", "routes/api.health.ts"),
  // better-auth mounts its whole surface here: magic link, passkey, session.
  route("api/auth/*", "routes/api.auth.$.ts"),
] satisfies RouteConfig;
