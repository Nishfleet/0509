import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const SERVER_ONLY_IMPORTS = [
  {
    group: ["**/*.server", "**/*.server.ts", "**/*.server.js"],
    message:
      "A client module may not import a *.server module. Only route modules and other *.server modules may. React Router tree-shakes .server files out of the browser bundle only for route modules; anywhere else the server code ships to the browser. docs/REBUILD-TRUST.md C1.",
  },
  {
    name: "cloudflare:workers",
    message:
      "cloudflare:workers is a Workers runtime module and does not exist in the browser. Bindings are read in *.server modules and passed down. Source: commit 7727bf787 / #3918.",
  },
];

const ONE_PAVED_PATH_IMPORTS = [
  {
    name: "kysely",
    message:
      "kysely is imported in exactly one module, app/lib/db.server.ts, which exports the one query builder instance. One data layer, one connection, one place to change. docs/REBUILD-TRUST.md C4. Source: talk 25:26 (a single paved path per blessed pattern).",
  },
  {
    name: "better-auth",
    message:
      "better-auth is configured in exactly one module, app/lib/auth.server.ts, which exports createAuth(). A second betterAuth() call is a second session authority. docs/REBUILD-TRUST.md C4.",
  },
  {
    name: "@better-auth/api-key",
    message: "Same paved path as better-auth: app/lib/auth.server.ts only.",
  },
  {
    name: "@better-auth/passkey",
    message: "Same paved path as better-auth: app/lib/auth.server.ts only.",
  },
];

const BANNED_SYNTAX = [
  {
    selector: "NewExpression[callee.name='RegExp'] > Literal.arguments, NewExpression[callee.name='RegExp'] > TemplateLiteral",
    message:
      "A regex built from a string cannot be shown to escape that string's metacharacters, so a '.' matches any host and an unexpected '\\' breaks the pattern. Two live alerts on 0509#4172 came from exactly this shape (CodeQL js/incomplete-hostname-regexp, 8 high alerts) plus a fan-out that probed once per match instead of once per board. Extract the candidate out of the text and parse it with `new URL()`, then match the hostname against a table with an exact comparison. Source: 0509#4172, commit sequence ending bdca157.",
  },
  {
    selector:
      "MemberExpression[object.name='context'][property.name='cloudflare']",
    message:
      "context.cloudflare is the React Router 7 shape and does not exist here; this app provides no getLoadContext, so reading it throws and the route 500s. Bindings come from `import { env } from 'cloudflare:workers'`. Source: commit 7727bf787 / #3918 (production regression: /api/auth, /app and the magic-link POST all 500d).",
  },
  {
    selector:
      "Program > VariableDeclaration > VariableDeclarator[init.type='NewExpression'][init.callee.name=/^(Response|Request|Headers)$/]",
    message:
      "A Response/Request/Headers constructed in a module's global scope is I/O that workerd refuses at boot: 'Disallowed operation called within global scope' fails the whole Worker, every route included (0509#3969 preview-assert). Build it inside the request. `URL` is allowed here because workerd permits it.",
  },
  {
    selector:
      "FunctionDeclaration[id.name=/^(loader|action|meta|headers|links)$/] ObjectPattern > TSTypeAnnotation > TSTypeLiteral",
    message:
      "A hand-written object type on a loader/action parameter asserts the framework's shape instead of checking it, and silences the error that would have caught a wrong shape. Use the generated types: `import type { Route } from './+types/<route>'` then Route.LoaderArgs / Route.ActionArgs / Route.ComponentProps. Source: commit ce5fed17d.",
  },
];

const WRITER_SYNTAX = [
  {
    selector:
      "CallExpression[callee.property.name=/^(insertInto|updateTable|deleteFrom)$/]",
    message:
      "One writer per table. Writes live in app/lib/data/<table>.server.ts, never in a route or a component. A route that writes directly becomes the second writer the moment another route needs the same row. docs/REBUILD-TRUST.md C5.",
  },
  {
    selector: "MemberExpression[object.name='env'][property.name='DB']",
    message:
      "Routes do not touch env.DB — not even to hand it to a helper. Go through the one data layer in app/lib/data/. Widened from the env.DB(...) call form after #3885's route walked through env.DB.prepare(...). docs/REBUILD-TRUST.md C4.",
  },
];

const WORKAROUND_TERMS = [
  "todo",
  "fixme",
  "xxx",
  "hack",
  "workaround",
  "work around",
  "for now",
  "temporary",
  "temporarily",
  "not ideal",
  "should be",
  "ideally",
  "revisit",
  "later",
];

export default tseslint.config(
  {
    ignores: [
      "build/**",
      "coverage/**",
      "dist/**",
      ".react-router/**",
      // wrangler dev / `npm run e2e` write generated bundles under
      // .wrangler/tmp. Git already ignores them (.gitignore); without this
      // entry `eslint .` lints them and `npm run lint` fails after any local
      // run. Same class as .react-router/** and worker-configuration.d.ts.
      // Source: #3944.
      ".wrangler/**",
      "node_modules/**",
      "worker-configuration.d.ts",
      "docs/design-directions/**",
      "**/+types/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },

  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/only-throw-error": [
        "error",
        { allow: [{ from: "lib", name: "Response" }] },
      ],
    },
  },

  {
    files: ["app/**/*.{ts,tsx}", "workers/**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-inline-comments": "error",
      "no-warning-comments": [
        "error",
        { terms: WORKAROUND_TERMS, location: "anywhere" },
      ],
      "no-restricted-syntax": ["error", ...BANNED_SYNTAX],
    },
  },

  {
    files: ["app/**/*.{ts,tsx}"],
    ignores: [
      "app/**/*.server.ts",
      "app/routes/**",
      "app/root.tsx",
      "app/entry.*.tsx",
    ],
    rules: {
      "no-restricted-imports": ["error", { paths: [], patterns: SERVER_ONLY_IMPORTS.filter((r) => "group" in r), }],
    },
  },

  {
    files: ["app/**/*.{ts,tsx}", "workers/**/*.ts"],
    ignores: ["app/lib/db.server.ts", "app/lib/auth.server.ts", "app/lib/auth-client.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ONE_PAVED_PATH_IMPORTS,
          patterns: [
            {
              group: ["better-auth/*", "@better-auth/passkey/*", "@better-auth/api-key/*"],
              message:
                "better-auth subpath imports (client SDKs, plugin clients) live in exactly one module, app/lib/auth-client.ts; the server config stays in app/lib/auth.server.ts. A second import site is a second session authority. Source: 0509#3961 review — `paths` matches exact specifiers only, so `better-auth/client` slipped past the bare-name rule.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["app/routes/**/*.{ts,tsx}"],
    rules: {
      "max-lines": ["error", { max: 150, skipBlankLines: false, skipComments: false }],
      "no-restricted-syntax": ["error", ...BANNED_SYNTAX, ...WRITER_SYNTAX],
    },
  },

  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "*.config.ts", "e2e/**/*.ts", "tests/**/*.ts"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "no-inline-comments": "off",
      "no-warning-comments": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
);
