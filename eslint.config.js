import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import importX, { createNodeResolver } from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import noComments from "eslint-plugin-no-comments";
import globals from "globals";
import tseslint from "typescript-eslint";

const SERVER_IMPORT_RECEIPT =
  "A client module may not import a *.server module. Only route modules and other *.server modules may. React Router tree-shakes .server files out of the browser bundle only for route modules; anywhere else the server code ships to the browser. docs/REBUILD-TRUST.md C1.";

const CLOUDFLARE_WORKERS_IMPORT = {
  name: "cloudflare:workers",
  message:
    "cloudflare:workers is a Workers runtime module and does not exist in the browser. Bindings are read in *.server modules and passed down. Source: commit 7727bf787 / #3918.",
};

const PAVED_PATH_PATTERNS = [
  {
    group: ["better-auth/*", "@better-auth/passkey/*", "@better-auth/api-key/*"],
    message:
      "better-auth subpath imports (client SDKs, plugin clients) live in exactly one module, app/lib/auth-client.ts; the server config stays in app/lib/auth.server.ts. A second import site is a second session authority. Source: 0509#3961 review — `paths` matches exact specifiers only, so `better-auth/client` slipped past the bare-name rule.",
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

const SUPPORT_ADDRESS_BAN = {
  selector:
    "Literal[value='support@0509.io'], TemplateLiteral[quasis.0.value.raw='support@0509.io'], JSXText[value=/support@0509\\.io/], Literal[value='mailto:support@0509.io']",
  message:
    "The support address is typed once, in app/components/footer.tsx; every page imports <Footer /> instead. A second literal is a second address to change and a page that silently keeps the old one. Source: 0509#3986 review — `encoded: structure` names rung 1, and a constant alone does not stop a re-type.",
};

const BANNED_SYNTAX = [
  SUPPORT_ADDRESS_BAN,
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
    plugins: { "react-hooks": reactHooks, "no-comments": noComments },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-comments/disallowComments": [
        "error",
        { allow: ["eslint", "global"] },
      ],
      "no-inline-comments": "error",
      "no-warning-comments": [
        "error",
        { terms: WORKAROUND_TERMS, location: "anywhere" },
      ],
      "no-restricted-syntax": ["error", ...BANNED_SYNTAX],
    },
  },

  {
    // The one blessed site for the support address. It still bans every other
    // shape; only the address literal is allowed here. 0509#3986.
    files: ["app/components/footer.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...BANNED_SYNTAX.filter((rule) => rule !== SUPPORT_ADDRESS_BAN),
      ],
    },
  },

  {
    files: ["app/**/*.{ts,tsx}", "workers/**/*.ts"],
    ignores: ["app/lib/db.server.ts", "app/lib/auth.server.ts", "app/lib/auth-client.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: ONE_PAVED_PATH_IMPORTS, patterns: PAVED_PATH_PATTERNS },
      ],
    },
  },

  {
    files: ["app/**/*.{ts,tsx}"],
    ignores: [
      "app/**/*.server.ts",
      "app/routes/**",
      "app/root.tsx",
      "app/entry.*.tsx",
      "app/lib/auth-client.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...ONE_PAVED_PATH_IMPORTS, CLOUDFLARE_WORKERS_IMPORT],
          patterns: PAVED_PATH_PATTERNS,
        },
      ],
    },
  },

  {
    files: ["app/lib/auth-client.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...ONE_PAVED_PATH_IMPORTS, CLOUDFLARE_WORKERS_IMPORT],
        },
      ],
    },
  },

  {
    files: ["app/**/*.{ts,tsx}", "workers/**/*.ts"],
    plugins: { boundaries, "import-x": importX },
    settings: {
      "import/resolver": {
        node: { extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] },
      },
      "import-x/extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
      "import-x/parsers": {
        "@typescript-eslint/parser": [".ts", ".tsx"],
      },
      "import-x/resolver-next": [
        createNodeResolver({
          extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
        }),
      ],
      "boundaries/elements": [
        { type: "data-writer", pattern: "app/lib/data", partialMatch: false },
        { type: "component", pattern: "app/components", partialMatch: false },
        { type: "route", pattern: "app/routes", partialMatch: false },
        { type: "worker", pattern: "workers", partialMatch: false },
      ],
      "boundaries/files": [
        { category: "db", pattern: "app/lib/db.server.ts" },
        { category: "auth", pattern: "app/lib/auth.server.ts" },
        { category: "data-writer", pattern: "app/lib/data/**/*.server.ts" },
        { category: "server-leaf", pattern: "app/lib/**/*.server.ts" },
        { category: "server-module", pattern: "app/**/*.server.ts" },
        {
          category: "route-module",
          pattern: ["app/routes/**/*.ts", "app/routes/**/*.tsx", "app/root.tsx"],
        },
        { category: "entry", pattern: ["app/entry.*.ts", "app/entry.*.tsx"] },
        { category: "worker", pattern: "workers/**/*.ts" },
        { category: "client", pattern: ["app/**/*.ts", "app/**/*.tsx"] },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            {
              from: {
                file: {
                  categories: {
                    anyOf: ["client"],
                    noneOf: ["server-module", "route-module", "entry"],
                  },
                },
              },
              disallow: { to: { file: { categories: "server-module" } } },
              message: SERVER_IMPORT_RECEIPT,
            },
            {
              from: { element: { type: "component" } },
              disallow: { to: { file: { categories: "server-module" } } },
              message: SERVER_IMPORT_RECEIPT,
            },
            {
              allow: {
                to: {
                  file: {
                    categories: { anyOf: ["client"], noneOf: ["server-module", "route-module"] },
                  },
                },
              },
            },
            {
              from: [{ element: { type: "route" } }, { file: { categories: "route-module" } }],
              allow: {
                to: [
                  { element: { type: "component" } },
                  { element: { type: "data-writer" } },
                  { file: { categories: { anyOf: ["server-leaf", "db", "auth"] } } },
                ],
              },
            },
            {
              from: { file: { categories: "entry" } },
              allow: {
                to: [
                  { element: { type: "component" } },
                  { file: { categories: "server-module" } },
                ],
              },
            },
            {
              from: {
                file: {
                  categories: {
                    anyOf: ["server-leaf"],
                    noneOf: ["data-writer", "db", "auth"],
                  },
                },
              },
              allow: {
                to: {
                  file: { categories: { anyOf: ["server-leaf", "data-writer", "db", "auth"] } },
                },
              },
            },
            {
              from: { element: { type: "data-writer" } },
              allow: {
                to: {
                  file: {
                    categories: {
                      anyOf: ["data-writer", "db", "server-leaf"],
                      noneOf: ["auth"],
                    },
                  },
                },
              },
            },
            {
              from: { file: { categories: "auth" } },
              allow: {
                to: [
                  { file: { categories: { anyOf: ["server-leaf", "data-writer", "db"] } } },
                  { element: { type: "worker" } },
                ],
              },
            },
            {
              from: { element: { type: "worker" } },
              allow: { to: { file: { categories: "server-module" } } },
            },
          ],
        },
      ],
      "import-x/no-cycle": ["error", { ignoreExternal: true }],
    },
  },

  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    plugins: { "import-x": importX },
    rules: { "import-x/no-default-export": "error" },
  },

  {
    files: [
      "app/routes/**/*.{ts,tsx}",
      "app/root.tsx",
      "app/routes.ts",
      "app/entry.*.{ts,tsx}",
      "**/*.config.{ts,js,mjs,cjs}",
      "eslint.config.js",
      "workers/app.ts",
      "workers/fixture-site.ts",
      "workers/e2e-inbox.ts",
    ],
    rules: { "import-x/no-default-export": "off" },
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
