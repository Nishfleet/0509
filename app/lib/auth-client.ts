import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient, type ReactAuthClient } from "better-auth/react";

// Type annotation on purpose (issue #1948): the implicitly inferred type of
// `betterAuth`/`createAuthClient` instances reaches zod schema types. When
// npm splits zod into package-private copies (e.g. @better-auth/passkey's
// ^4.5.4 floor above the root zod after a Dependabot bump), the inferred
// type references `better-auth/node_modules/zod/...` — a path the compiler
// cannot name in a declaration, so the app typecheck fails (TS2742) on any
// such lock layout. Naming the instance type with the library's own public
// exports keeps it portable on every tree. ReactAuthClient derives every
// member (api endpoints, hooks, session) from the plugins tuple, so this
// annotation preserves the exact surface.
export type AuthClientOptions = {
  plugins: [ReturnType<typeof passkeyClient>];
};

export const authClient: ReactAuthClient<AuthClientOptions> = createAuthClient({
  plugins: [passkeyClient()],
});
