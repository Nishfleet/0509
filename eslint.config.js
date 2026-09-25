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

const SONNER_IMPORT = {
  name: "sonner",
  message:
    "sonner is imported in exactly one module, app/components/toaster.tsx, which owns every toast() call behind toastSaved(). DESIGN.md §11: toasts are only 'saved' and 'undo' — a second import site is a second toast authority. Source: 0509#4116.",
};

const FAST_XML_PARSER_IMPORT = {
  name: "fast-xml-parser",
  message:
    "Feed XML is parsed only by @extractus/feed-extractor in workers/sources/mentions/feed.ts. A direct fast-xml-parser import is a second parser. Source: 0509#4051.",
};

const ONE_PAVED_PATH_IMPORTS = [
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
  SONNER_IMPORT,
  FAST_XML_PARSER_IMPORT,
];

const SUPPORT_ADDRESS_BAN = {
  selector:
    "Literal[value='support@0509.io'], TemplateLiteral[quasis.0.value.raw='support@0509.io'], JSXText[value=/support@0509\\.io/], Literal[value='mailto:support@0509.io']",
  message:
    "The support address is typed once, in app/components/footer.tsx; every page imports <Footer /> instead. A second literal is a second address to change and a page that silently keeps the old one. Source: 0509#3986 review — `encoded: structure` names rung 1, and a constant alone does not stop a re-type.",
};

// A catch whose only statement is `return null` swallows the error: a thrown
// fetch, a bug, and a genuine "not found" all reach the caller as the same
// null, so the failure leaves no trace. Match the block shape, not a promise
// `.catch(() => null)` callback. The named clause in
// app/lib/identity/name-cascade.ts is grandfathered by name (see the
// exemption block) until the cascade grows a logged failure path. Source:
// 0509#4462 (REBUILD-TRUST.md C1 Q1 — the D grade on PR #4457).
const CATCH_RETURNS_NULL = {
  selector:
    "CatchClause > BlockStatement[body.length=1] > ReturnStatement[argument.value=null]",
  message:
    "A catch whose only statement is `return null` swallows the error, so a thrown fetch or a bug fails as silently as a real 'not found'. Give the clause an error binding and a logged failure path (or rethrow). Source: 0509#4462.",
};

const FEED_STATE_LITERAL = {
  selector:
    "ObjectExpression > Property[key.name='feedState'][value.value=/^(ok|stale|error)$/]",
  message:
    "Only workers/sources/mentions/youtube.ts may build a YouTube feedState. commitYoutubeFeed accepts OkYoutubeFeed alone, so a stale or error feed cannot be stored as zero videos. Source: 0509#4051.",
};

const XML_PARSER_CONSTRUCTOR = {
  selector: "NewExpression[callee.name='XMLParser']",
  message:
    "Feed XML is parsed only by @extractus/feed-extractor in workers/sources/mentions/feed.ts. A second XMLParser is a second feed path. Source: 0509#4051.",
};

const BANNED_SYNTAX = [
  SUPPORT_ADDRESS_BAN,
  CATCH_RETURNS_NULL,
  XML_PARSER_CONSTRUCTOR,
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

// Full DML write shapes, strict enough to run unanchored: UPDATE needs the
// `SET col =` tail so prose like "the update was set" cannot match.
const DML_WRITE_SHAPE =
  "INSERT(\\s+OR\\s+\\w+)?\\s+INTO|REPLACE\\s+INTO|UPDATE\\s+[\\w\".]+\\s+SET\\s+[\\w\".]+\\s*=|DELETE\\s+FROM";

// The same shapes anchored at statement start, plus `WITH`-led writes (a CTE
// can head INSERT/UPDATE/DELETE; a `WITH … SELECT` read stays allowed because
// the inner shape must still match). The UPDATE arm carries the table-then-SET
// tail too: a bare `UPDATE\s` under the leading anchor only fixed position,
// not shape, so prose literals like "Update saved" tripped the gate
// (0509#4383). The `$` alternative is load-bearing for an interpolated table —
// `UPDATE ${table} SET …` has `"UPDATE "` as its whole first quasi, which the
// table-then-SET tail cannot span but end-of-quasi can.
const RAW_DML_START =
  `^\\s*(INSERT(\\s+OR\\s+\\w+)?\\s+INTO|REPLACE\\s+INTO|UPDATE\\s+([\\w".]+\\s+SET\\b|$)|DELETE\\s+FROM` +
  `|WITH\\b[\\s\\S]*\\b(${DML_WRITE_SHAPE}))`;

const RAW_DML_WRITER = {
  selector:
    `Literal[value=/${RAW_DML_START}/i], ` +
    `TemplateLiteral[quasis.0.value.raw=/${RAW_DML_START}/i], ` +
    `TemplateElement[value.raw=/${DML_WRITE_SHAPE}/i]`,
  message:
    "One writer per table. Raw DML lives in app/lib/data/<table>.server.ts — this matches the statement text itself, so holding it in a module constant still counts. docs/REBUILD-TRUST.md C5. Source: 0509#4313 — the kysely-era insertInto/updateTable/deleteFrom selectors matched nothing after the raw-D1 rebuild, and app/lib/workspace.server.ts grew a second workspace writer while the rule stayed green.",
};

const ENV_DB_IN_ROUTES = {
  selector: "CallExpression[callee.object.name='env'][callee.property.name='DB']",
  message:
    "Routes do not touch env.DB. Go through the one data layer in app/lib/data/. docs/REBUILD-TRUST.md C4.",
};

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
      "no-restricted-syntax": ["error", ...BANNED_SYNTAX, FEED_STATE_LITERAL],
    },
  },

  {
    // The writer rule fires on the DML statement text, not a call shape: this
    // repo keeps its SQL in module constants (0509#4313), so matching only a
    // prepare(<literal>) argument would stay green while a second writer
    // exists. app/lib/data/** is the paved path. workers/e2e-inbox.ts and
    // workers/fixture-site.ts write their own Durable Object sqlite via
    // ctx.storage.sql — never env.DB — so they sit outside this rule's scope by
    // kind, not by exemption. The
    // selector covers INSERT OR <conflict> INTO, REPLACE INTO and WITH-led
    // writes, not only a leading INSERT INTO/UPDATE/DELETE FROM.
    // A later matching block's no-restricted-syntax entry replaces the
    // earlier one wholesale — flat config never merges a rule's option
    // array — which is why this array restates BANNED_SYNTAX instead of
    // appending.
    files: ["app/**/*.{ts,tsx}", "workers/**/*.ts"],
    ignores: ["app/lib/data/**", "workers/e2e-inbox.ts", "workers/fixture-site.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...BANNED_SYNTAX, RAW_DML_WRITER, FEED_STATE_LITERAL],
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
        RAW_DML_WRITER,
        FEED_STATE_LITERAL,
      ],
    },
  },

  {
    files: ["app/**/*.{ts,tsx}", "workers/**/*.ts"],
    ignores: [
      "app/lib/auth.server.ts",
      "app/lib/auth-client.ts",
      "app/components/toaster.tsx",
    ],
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
      "app/components/toaster.tsx",
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
    files: ["app/components/toaster.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...ONE_PAVED_PATH_IMPORTS.filter((p) => p !== SONNER_IMPORT),
            CLOUDFLARE_WORKERS_IMPORT,
          ],
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
                  { file: { categories: { anyOf: ["server-leaf", "auth"] } } },
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
                    noneOf: ["data-writer", "auth"],
                  },
                },
              },
              allow: {
                to: {
                  file: { categories: { anyOf: ["server-leaf", "data-writer", "auth"] } },
                },
              },
            },
            {
              from: { element: { type: "data-writer" } },
              allow: {
                to: {
                  file: {
                    categories: {
                      anyOf: ["data-writer", "server-leaf"],
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
                  { file: { categories: { anyOf: ["server-leaf", "data-writer"] } } },
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
      "workers/support-inbox.ts",
    ],
    rules: { "import-x/no-default-export": "off" },
  },

  {
    files: ["app/routes/**/*.{ts,tsx}"],
    rules: {
      "max-lines": ["error", { max: 150, skipBlankLines: false, skipComments: false }],
      "no-restricted-syntax": [
        "error",
        ...BANNED_SYNTAX,
        RAW_DML_WRITER,
        ENV_DB_IN_ROUTES,
        FEED_STATE_LITERAL,
      ],
    },
  },

  {
    files: ["workers/sources/mentions/youtube.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...BANNED_SYNTAX, RAW_DML_WRITER],
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
