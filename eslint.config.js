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
    selector:
      "MemberExpression[object.name='context'][property.name='cloudflare']",
    message:
      "context.cloudflare is the React Router 7 shape and does not exist here; this app provides no getLoadContext, so reading it throws and the route 500s. Bindings come from `import { env } from 'cloudflare:workers'`. Source: commit 7727bf787 / #3918 (production regression: /api/auth, /app and the magic-link POST all 500d).",
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
    selector: "CallExpression[callee.object.name='env'][callee.property.name='DB']",
    message:
      "Routes do not touch env.DB. Go through the one data layer in app/lib/data/. docs/REBUILD-TRUST.md C4.",
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
    ignores: ["app/lib/db.server.ts", "app/lib/auth.server.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: ONE_PAVED_PATH_IMPORTS }],
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
