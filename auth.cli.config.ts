// Used only by `npx auth generate`. Not imported by the app.
// D1's binding exists only inside workerd, so the CLI cannot introspect it from
// Node; D1 is SQLite and the emitted DDL is dialect-identical, so generation
// runs against an empty local SQLite file instead.
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { SqliteDialect } from "kysely";

export const auth = betterAuth({
  database: {
    dialect: new SqliteDialect({ database: new Database(":memory:") }),
    type: "sqlite",
  },
  plugins: [magicLink({ sendMagicLink: async () => {} }), passkey(), apiKey()],
});
