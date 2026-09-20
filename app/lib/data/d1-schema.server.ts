/**
 * Code-facing schema for the Kysely instance from `d1.server.ts` (#3783).
 *
 * Column names are camelCase: `CamelCasePlugin` translates them to the
 * snake_case columns `migrations/*.sql` create and maps result rows back, so
 * entries here mirror the domain `*Record` shapes rather than the snake_case
 * `*Row` interfaces. Tables are added one `data/` directory at a time as each
 * mapper slice lands; intentionally empty until the first slice needs it.
 */
export interface Database {}
