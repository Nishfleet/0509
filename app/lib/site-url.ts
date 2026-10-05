/**
 * The one production origin (0509#7124).
 *
 * This file is a leaf on purpose: it imports nothing, so both the marketing
 * side (`structured-data.ts`, whose `SITE_URL` feeds canonical tags, `og:url`
 * and the MCP URL) and the Worker's boot path (`env.server.ts`) can read the
 * same literal without pulling the React tree — `structured-data.ts` imports
 * `app/components/footer` — into the Worker.
 *
 * `wrangler.jsonc`'s `vars.BETTER_AUTH_URL` is the third writer and the one
 * that actually deploys. `tests/wrangler-bindings.test.ts` pins it to this
 * constant, so an origin that drifts from the deployed one is a red test
 * rather than silently wrong canonical tags.
 */
export const SITE_URL = "https://0509.io";
