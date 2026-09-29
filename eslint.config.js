import js from "@eslint/js";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import boundaries from "eslint-plugin-boundaries";
import importX, { createNodeResolver } from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import noComments from "eslint-plugin-no-comments";
import playwright from "eslint-plugin-playwright";
import vitest from "@vitest/eslint-plugin";
import globals from "globals";
import tseslint from "typescript-eslint";

const SERVER_IMPORT_RECEIPT =
  "A client module may not import a *.server module. Only route modules and other *.server modules may. React Router tree-shakes .server files out of the browser bundle only for route modules; anywhere else the server code ships to the browser. docs/REBUILD-TRUST.md C1.";

const CLOUDFLARE_WORKERS_IMPORT = {
  name: "cloudflare:workers",
  message:
    "cloudflare:workers is a Workers runtime module and does not exist in the browser. Bindings are read in *.server modules and passed down. Source: commit 7727bf787 / #3918.",
};

const FULL_ZOD_IMPORT = {
  name: "zod",
  message:
    "app/components/ ships to the browser; full zod costs about 13 KB gzipped per object schema there. Import from \"zod/mini\" instead (docs/REBUILD-STACK.md, zod). Source: 0509#4134.",
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

const UPLOT_IMPORT = {
  name: "uplot",
  message:
    "uPlot is 22 KB gzipped and loads only in app/components/four-week-plot.tsx, which four-week-line.tsx pulls in with React.lazy so it stays out of the /app entry (docs/REBUILD-DONE.md §B, 150 KB). Source: 0509#5289.",
};

const UPLOT_REACT_IMPORT = {
  name: "uplot-react",
  message:
    "uPlot is 22 KB gzipped and loads only in app/components/four-week-plot.tsx, which four-week-line.tsx pulls in with React.lazy so it stays out of the /app entry (docs/REBUILD-DONE.md §B, 150 KB). Source: 0509#5289.",
};

const FOUR_WEEK_PLOT_STATIC_IMPORT = {
  name: "./four-week-plot",
  message:
    'Load four-week-plot with React.lazy(() => import("./four-week-plot")), never a static import: a static import puts uPlot back in the /app entry. Source: 0509#5289.',
};

const CHART_IMPORTS = [UPLOT_IMPORT, UPLOT_REACT_IMPORT, FOUR_WEEK_PLOT_STATIC_IMPORT];

const FAST_XML_PARSER_IMPORT = {
  name: "fast-xml-parser",
  message:
    "Feed XML is parsed only by @extractus/feed-extractor in workers/sources/mentions/feed.ts. A direct fast-xml-parser import is a second parser. Source: 0509#4051.",
};

const UNSCOPED_WRITER_MESSAGE =
  "Unscoped system writer: this writer updates by id alone, with no workspace_id, because only workers and workflows call it. A route importing it is a cross-workspace write. Routes go through a workspace-scoped writer instead. Source: 0509#4705.";

const UNSCOPED_WRITER_PATTERNS = [
  {
    group: [
      "**/data/send_attempt.server",
      "**/data/watch.server",
      "**/data/incident.server",
      "**/data/snapshot.server",
    ],
    message: UNSCOPED_WRITER_MESSAGE,
  },
  // These two modules are banned by import NAME, never as a whole module:
  // routes legitimately import other names from them, so a module-wide ban
  // would break the reads and the workspace-scoped schedule writer.
  {
    group: ["**/data/digest.server"],
    importNames: ["markDigestSent", "markDigestFailed"],
    message: UNSCOPED_WRITER_MESSAGE,
  },
  {
    group: ["**/data/workspace.server"],
    importNames: ["deleteWorkspace"],
    message: UNSCOPED_WRITER_MESSAGE,
  },
];

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
// `.catch(() => null)` callback. The clause in
// app/lib/identity/name-cascade.server.ts logs via console.error before its
// `return null`, so it holds two statements and does not match this shape.
// Source: 0509#4462 (REBUILD-TRUST.md C1 Q1 — the D grade on PR #4457).
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

// The one domain normaliser. The identity engine — app/lib/identity/normalise.ts
// (`normaliseSubject`) — owns every URL-to-domain reduction on the platform, so
// the onboarding card, the engine and the share tail read one set of rules. A
// second parser beside it can only drift: 0509#3999's review found a hand-rolled
// host beside the engine path, and its fix cut that parser out (#4321). This
// selector makes the second one structurally impossible rather than discouraged
// by convention. A host read for a non-identity purpose (a public-host guard, a
// job-board match, a www variant, a site-host allow) is grandfathered in the
// exemption block below, not here.
const DOMAIN_HOSTNAME_BAN = {
  selector: "MemberExpression[property.name='hostname']",
  message:
    "URL-to-domain extraction is owned by the identity engine in app/lib/identity/ — `normaliseSubject` in app/lib/identity/normalise.ts. Reading `.hostname` anywhere else is a second domain normaliser that will drift from the engine's rules; the same shape on any URL argument, any binding name. Reuse the engine (or, for a non-identity host read, get the file added to the exemption block below). Source: 0509#4371.",
};

// The one outbound-fetch path. app/lib/fetch/outbound.server.ts owns the
// public-host check (targetRefusal, URL + scheme policy), the redirect walk
// that re-checks every hop, the 8 s deadline (fetchOutbound) and the capped
// body reader (cappedBody); the crawler User-Agent is CRAWLER_USER_AGENT in
// robots.server.ts. A bare fetch( outside it is a second transport: the logo
// store's copy was the instance that raised this (its https-only rule and
// byte cap had already drifted from readUrl's). Call sites that predate the
// rule sit in the exemption blocks below, the same shape as
// DOMAIN_HOSTNAME_BAN's grandfather list.
const BARE_FETCH = {
  selector: "CallExpression[callee.name='fetch']",
  message:
    "Outbound fetch is owned by app/lib/fetch/: fetchOutbound refuses non-public hosts and re-checks every redirect hop under an 8 s deadline, and cappedBody bounds the body. A bare fetch( anywhere else is a second transport that drifts from all three. Source: 0509#4951.",
};

// DESIGN.md: fonts are self-hosted. A Google Fonts <link> put LCP at 2021 ms against the
// 1500 ms budget (CI run 35635617508, main 5166ebb81; fixed in fd1457288).
const GOOGLE_FONTS_BAN = {
  selector: "Literal[value=/fonts\\.(googleapis|gstatic)\\.com/], TemplateElement[value.raw=/fonts\\.(googleapis|gstatic)\\.com/]",
  message:
    "Fonts are self-hosted (DESIGN.md). A Google Fonts link is render-blocking and broke the 1500 ms LCP budget once (fd1457288). Add the font file under public/ and an @font-face instead.",
};

const CRAWLER_USER_AGENT_BAN = {
  selector:
    "Literal[value=/FiveToNineBot\\/\\d|0509\\.io\\/\\d/], TemplateElement[value.raw=/FiveToNineBot\\/\\d|0509\\.io\\/\\d/]",
  message:
    "The crawler User-Agent is typed once, in app/lib/fetch/robots.server.ts as CRAWLER_USER_AGENT (built from ROBOTS_AGENT, the token robots.txt is matched against); every module that fetches today imports it. A second literal is a second identity to change and a fetch that silently keeps the old one, which is how the same identity came to be typed in more than one place. The version is matched as /\\d/ so a bump is this edit, not a new literal. Modules that fetch without a User-Agent at all are 0509#5960. Source: 0509#5883.",
};

const USER_DATA_NAME = "^(email|emails|userId|ip|input|raw|prompt|password|token|subject)$";
// The one operator id the message allows, so `input.workspaceId` stays clean.
// Widen it only with a comment here naming why the new id is not user data.
const LOGGABLE_OPERATOR_ID = "workspaceId";
const LOG_OR_CAPTURE_CALL =
  "CallExpression:matches([callee.object.name='console'], [callee.name=/^(capture(Exception|Message|Event|Feedback)|set(Tag|Tags|Extra|Extras|Context|Attributes|User|ConversationId))$/], [callee.property.name=/^(capture(Exception|Message|Event|Feedback)|set(Tag|Tags|Extra|Extras|Context|Attributes|User|ConversationId))$/])";
const NO_USER_DATA_IN_LOGS_MESSAGE =
  "Logs and Sentry never carry customer data or prompt input: no email, user id, IP, raw input, prompt, subject, password or token, as a key, a value or a property read. Log the ids an operator needs (event, workspaceId) and an error message capped with .slice(0, 300). The selector matches names, so a renamed or aliased value is out of reach; review it. Privacy first (CLAUDE.md; workers/sentry.ts sendDefaultPii: false). Source: 0509#5776.";
const NO_USER_DATA_IN_LOGS = [
  {
    selector: `${LOG_OR_CAPTURE_CALL} :matches(Property[key.name=/${USER_DATA_NAME}/], Property[value.name=/${USER_DATA_NAME}/], MemberExpression[property.name=/${USER_DATA_NAME}/])`,
    message: NO_USER_DATA_IN_LOGS_MESSAGE,
  },
  { selector: `${LOG_OR_CAPTURE_CALL} > Identifier.arguments[name=/${USER_DATA_NAME}/]`, message: NO_USER_DATA_IN_LOGS_MESSAGE },
  // The first two cover a named key and a named value. These four close the
  // shapes the message promises but a name-only match misses: the `email` in
  // `console.log(`user ${email}`)`, the `subject` in `JSON.stringify(subject)`,
  // the `subject` in `{ ...subject }`, and the `subject` in
  // `console.log(subject.registrable)`. 0509#5786.
  { selector: `${LOG_OR_CAPTURE_CALL} TemplateLiteral > Identifier[name=/${USER_DATA_NAME}/]`, message: NO_USER_DATA_IN_LOGS_MESSAGE },
  { selector: `${LOG_OR_CAPTURE_CALL} CallExpression > Identifier[name=/${USER_DATA_NAME}/]`, message: NO_USER_DATA_IN_LOGS_MESSAGE },
  { selector: `${LOG_OR_CAPTURE_CALL} SpreadElement > Identifier[name=/${USER_DATA_NAME}/]`, message: NO_USER_DATA_IN_LOGS_MESSAGE },
  // The identifier wrapped in one expression: `"ip " + ip`, `[email]`,
  // `email ?? ""`, `flag ? email : "x"`. 0509#5786.
  {
    selector: `${LOG_OR_CAPTURE_CALL} :matches(BinaryExpression, ArrayExpression, LogicalExpression, ConditionalExpression) > Identifier[name=/${USER_DATA_NAME}/]`,
    message: NO_USER_DATA_IN_LOGS_MESSAGE,
  },
  // A read off a binding named like user data. `workspaceId` is the one
  // operator id the message allows, so `input.workspaceId` stays clean while
  // `subject.registrable` and `email.trim()` do not. An alias
  // (`const domain = subject.registrable; console.log({ domain })`) is beyond
  // any name-based selector; the rule bans the identifiers, not the provenance
  // (0509#5786).
  {
    selector: `${LOG_OR_CAPTURE_CALL} MemberExpression[object.name=/${USER_DATA_NAME}/][property.name!='${LOGGABLE_OPERATOR_ID}']`,
    message: NO_USER_DATA_IN_LOGS_MESSAGE,
  },
];

const BANNED_SYNTAX = [
  SUPPORT_ADDRESS_BAN,
  GOOGLE_FONTS_BAN,
  CRAWLER_USER_AGENT_BAN,
  CATCH_RETURNS_NULL,
  XML_PARSER_CONSTRUCTOR,
  DOMAIN_HOSTNAME_BAN,
  BARE_FETCH,
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

const STATIC_HOME_HTML_PARSER = {
  meta: { name: "static-home-html" },
  parse(text) {
    const lines = text.split("\n");
    const last = lines.length - 1;
    return {
      type: "Program",
      body: [],
      sourceType: "script",
      comments: [],
      tokens: [],
      loc: {
        start: { line: 1, column: 0 },
        end: { line: lines.length, column: lines[last].length },
      },
      range: [0, text.length],
    };
  },
};

const STATIC_HOME_FONT_PRELOAD = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      preload:
        "The static home must not preload a font. A preload holds the headline paint until the face arrives, so simulated LCP misses lighthouse-budget.json. The three faces stay on the @font-face rules with font-display: swap. Source: 0509#5580.",
      fontFace:
        "The static home must not declare @font-face in the document. A face that finishes before the headline is a simulated-LCP dependency and misses lighthouse-budget.json. The three faces live in /home-faces.css. Source: 0509#5598.",
      scannerLink:
        "The static home must not include a link element. The preload scanner fetches it before the headline paints, which puts /home-faces.css on the simulated LCP chain. Source: 0509#5630.",
      lateFaces:
        "The static home must append /home-faces.css from a load listener placed after </main>, so the brand faces are requested after the headline paints. Source: 0509#5630.",
    },
  },
  create(context) {
    return {
      Program(node) {
        const text = context.sourceCode.getText();
        const preloadsFont =
          /<link\b[^>]*\brel="preload"[^>]*\bas="font"/.test(text) ||
          /<link\b[^>]*\bas="font"[^>]*\brel="preload"/.test(text);
        if (preloadsFont) {
          context.report({ node, messageId: "preload" });
        }
        if (text.includes("@font-face")) {
          context.report({ node, messageId: "fontFace" });
        }
        if (/<link\b/i.test(text)) {
          context.report({ node, messageId: "scannerLink" });
        }
        const mainEnd = text.lastIndexOf("</main>");
        const scriptAt = text.indexOf("<script>");
        const scriptEnd = scriptAt < 0 ? -1 : text.indexOf("</script>", scriptAt);
        const script = scriptAt >= 0 && scriptEnd > scriptAt ? text.slice(scriptAt, scriptEnd) : "";
        const asksAfterLoad =
          script.includes('addEventListener("load"') &&
          script.includes('faces.href = "/home-faces.css"');
        if (mainEnd < 0 || scriptAt < mainEnd || !asksAfterLoad) {
          context.report({ node, messageId: "lateFaces" });
        }
      },
    };
  },
};

// DESIGN.md rule 8: "The accent is one colour. Green marker. Red exists only as
// the strike on a 'before' and the rule on an open incident. Nothing else is
// coloured, ever." These two restricted-class patterns make a second colour a
// diff the lint rejects instead of a review comment.
const TAILWIND_ARBITRARY_COLOUR = {
  pattern:
    "^(?:[^\\s]*:)*(?:bg|text|border|fill|stroke|ring|from|via|to|decoration|accent|caret|divide|outline|placeholder|shadow)-(?:\\[(?:#|rgb|hsl|oklch|oklab|lab|lch|color-mix|var\\()|\\(--)",
  message:
    "Arbitrary colour values are banned: every colour is a @theme token in app/app.css and the accent is one colour (DESIGN.md rule 8). Source: 0509#5871.",
};

const TAILWIND_DEFAULT_PALETTE = {
  pattern:
    "^(?:[^\\s]*:)*(?:bg|text|border|fill|stroke|ring|from|via|to|decoration|accent|caret|divide|outline|placeholder|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]",
  message:
    "The Tailwind default palette is banned: every colour is a @theme token in app/app.css (bg-green is the one accent, DESIGN.md rule 8). Source: 0509#5871.",
};

const SHADCN_STOCK_TOKEN_CLASSES =
  "(?:^|:)(?:bg|text|border|ring|fill|stroke)-(?:background|foreground|muted|muted-foreground|primary|primary-foreground|secondary|secondary-foreground|destructive|border|input|ring|popover|popover-foreground)(?:/[0-9]+)?$";

const TW_ANIMATE_STOCK_CLASSES =
  "(?:^|:)(?:animate-in|animate-out|fade-in-0|fade-out-0|zoom-in-95|zoom-out-95|slide-in-from-(?:top|bottom|left|right)-2)$";

// The plugin lints a `const X = "..."` class list only when it has been told
// the name: its own defaults are `className`, `classNames`, `classes` and
// `styles`, and this repo's convention is a bare SHOUTY name instead (ROW,
// WHEN_CLASS, BLOCK, TITLE, …). The list below is every class-list constant on
// main, so a colour smuggled into one of them is red, not green — without it
// `const ROW = "bg-[#ff0000]"` passed all three rules. A new class-list
// constant must add its name here; a name that is already used for a string
// that is not a class list (a `<title>`, a CSS custom property fallback) will
// report the words of that string as unknown classes, which is why the two
// such constants on main are named PAGE_TITLE (app/routes/landing.tsx) and
// LINE_FALLBACK (app/components/source-pill.tsx).
const TAILWIND_CLASS_VARIABLES = [
  // The plugin's own defaults, kept so setting this list does not drop them.
  "^classNames?$",
  "^classes$",
  "^styles?$",
  "^BLOCK$",
  "^BODY$",
  "^BRIEF$",
  "^BRIEF_LINE$",
  "^CARD$",
  "^DETAILS$",
  "^EYEBROW$",
  "^FIELD$",
  "^GREETING$",
  "^HEAD$",
  "^HEADING$",
  "^HEADING_CLASS$",
  "^LABEL$",
  "^LABEL_CLASS$",
  "^LINE$",
  "^LINK$",
  "^MARKER$",
  "^NOTE$",
  "^OFF$",
  "^PILL$",
  "^PREVIOUS_HEADING$",
  "^PREVIOUS_LINK$",
  "^PREVIOUS_LIST$",
  "^ROW$",
  "^ROW_CLASS$",
  "^SECTION$",
  "^SUMMARY$",
  "^TITLE$",
  "^WHEN_CLASS$",
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
      // Semgrep --test fixtures live next to their rules and intentionally
      // contain violating calls; they are in no tsconfig project, so typed
      // linting cannot see them either. Source: 0509#5661.
      ".semgrep/**",
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
    // No inline `eslint-disable`: one comment would silence every ban in this file
    // (the no-comments rule allows /eslint/ comments). Change the rule here, in review.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
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
      "no-restricted-syntax": ["error", ...BANNED_SYNTAX, ...NO_USER_DATA_IN_LOGS, FEED_STATE_LITERAL],
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
      "no-restricted-syntax": ["error", ...BANNED_SYNTAX, ...NO_USER_DATA_IN_LOGS, RAW_DML_WRITER, FEED_STATE_LITERAL],
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
        ...NO_USER_DATA_IN_LOGS,
        RAW_DML_WRITER,
        FEED_STATE_LITERAL,
      ],
    },
  },

  {
    // The one domain normaliser: the identity engine. These files read `.hostname`
    // for a purpose that is not domain normalisation, so the shared selector is
    // restated without `DOMAIN_HOSTNAME_BAN`: the identity engine itself, a
    // public-host guard in the transport layer, the job-board host match, this
    // site's www variant and page-host display, and the support worker's
    // site-host allow. Every
    // other `.hostname` read in app/ or workers/ keeps the ban. This block
    // restates the list because a later matching block's no-restricted-syntax
    // entry replaces the earlier one wholesale (flat config never merges a rule's
    // option array). 0509#4371.
    files: [
      "app/lib/identity/**/*.{ts,tsx}",
      "app/lib/fetch/transport.server.ts",
      "app/lib/hiring/discover-board.ts",
      "app/lib/site/own-site.server.ts",
      "workers/support-inbox.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...BANNED_SYNTAX.filter((rule) => rule !== DOMAIN_HOSTNAME_BAN),
        ...NO_USER_DATA_IN_LOGS,
        RAW_DML_WRITER,
        FEED_STATE_LITERAL,
      ],
    },
  },

  {
    // BARE_FETCH grandfathers: these files called fetch before the rule
    // existed (0509#4951). They keep every other ban — the array restates the
    // shared list because a later matching block's no-restricted-syntax entry
    // replaces the earlier one wholesale. New outbound fetch belongs in
    // app/lib/fetch/, not on this list.
    files: [
      "app/lib/liveness-ping.server.ts",
      "app/lib/discovery/generators/ai.server.ts",
      "app/lib/discovery/resolve-domain.server.ts",
      "app/lib/discovery/types.ts",
      "app/lib/observability/cost-analytics.server.ts",
      "app/components/share-button.tsx",
      "workers/sources/mentions/types.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...BANNED_SYNTAX.filter((rule) => rule !== BARE_FETCH),
        ...NO_USER_DATA_IN_LOGS,
        RAW_DML_WRITER,
        FEED_STATE_LITERAL,
      ],
    },
  },

  {
    // The same grandfather for files that also sit in the hostname exemption
    // above (their .hostname reads stay allowed) — plus the whole fetch paved
    // path itself, where the guard's host check and the wrapped call live by
    // definition. app/lib/identity/** stays listed file by file here so a NEW
    // fetch caller there (the second wrapper this rule exists to stop) still
    // fires: only the two callers that predate the rule are exempted.
    files: [
      "app/lib/fetch/**",
      "app/lib/identity/youtube-channel.server.ts",
      "app/lib/hiring/discover-board.ts",
      "workers/support-inbox.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...BANNED_SYNTAX.filter(
          (rule) => rule !== BARE_FETCH && rule !== DOMAIN_HOSTNAME_BAN,
        ),
        ...NO_USER_DATA_IN_LOGS,
        RAW_DML_WRITER,
        FEED_STATE_LITERAL,
      ],
    },
  },

  // Lean code is a lint, not a review note: Nish 2026-09-28 16:47Z, "all work
  // anywhere by any agent should be done as a pro dev team would. lean and
  // mean", and "make this non negotiable as lints and hard blocks" (0509#5783).
  // Limits sit at the common industry defaults, below main's p99. Code on main
  // that is already over them is listed in eslint-suppressions.json (ESLint
  // bulk suppressions), so new code meets the limit, a listed function cannot
  // grow its count, and a fix that removes one fails lint until the entry is
  // pruned with `npx eslint --prune-suppressions`.
  {
    files: ["app/**/*.{ts,tsx}", "workers/**/*.ts"],
    rules: {
      complexity: ["error", 10],
      "max-depth": ["error", 3],
      "max-params": ["error", 3],
      "max-lines-per-function": ["error", { max: 50, skipBlankLines: true, skipComments: true }],
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
    files: ["app/components/**/*.{ts,tsx}"],
    ignores: ["app/components/toaster.tsx", "app/components/four-week-plot.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...ONE_PAVED_PATH_IMPORTS, CLOUDFLARE_WORKERS_IMPORT, FULL_ZOD_IMPORT, ...CHART_IMPORTS],
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
            FULL_ZOD_IMPORT,
            ...CHART_IMPORTS,
          ],
          patterns: PAVED_PATH_PATTERNS,
        },
      ],
    },
  },

  {
    files: ["app/components/four-week-plot.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...ONE_PAVED_PATH_IMPORTS, CLOUDFLARE_WORKERS_IMPORT, FULL_ZOD_IMPORT],
          patterns: PAVED_PATH_PATTERNS,
        },
      ],
    },
  },

  // Flat config replaces a rule's options wholesale, so this block restates
  // ONE_PAVED_PATH_IMPORTS and PAVED_PATH_PATTERNS — a block with only the
  // new pattern would silently drop the better-auth/sonner bans for routes.
  // Source: 0509#4705.
  {
    files: ["app/routes/**/*.{ts,tsx}", "app/root.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ONE_PAVED_PATH_IMPORTS,
          patterns: [...PAVED_PATH_PATTERNS, ...UNSCOPED_WRITER_PATTERNS],
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
            {
              from: { file: { path: "app/lib/delivery-address.server.ts" } },
              allow: { to: { file: { path: "workers/delivery/send.ts" } } },
              message:
                "The delivery-address save is the second app-side sender after app/lib/auth.server.ts, and it goes through the one paved path (workers/delivery/send.ts) instead of calling env.EMAIL.send a second time. Only that one file reaches the worker; every other server leaf keeps the boundary. Source: 0509#5811.",
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
        ...NO_USER_DATA_IN_LOGS,
        RAW_DML_WRITER,
        ENV_DB_IN_ROUTES,
        FEED_STATE_LITERAL,
      ],
    },
  },

  {
    files: ["workers/sources/mentions/youtube.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...BANNED_SYNTAX, ...NO_USER_DATA_IN_LOGS, RAW_DML_WRITER],
    },
  },

  // 0509#5785, shipped by 0509#5808. Never skip, disable or quarantine a test
  // to get green: a focused test silently drops the rest of the suite, and a
  // disabled test stops testing the thing it names. Every rule below is stock
  // and carries its own message; `maxArgs: 2` is the one non-default value,
  // because the node suite passes a failure message as `expect`'s second
  // argument.
  {
    files: ["tests/**/*.ts"],
    plugins: { vitest },
    rules: {
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "error",
      "vitest/no-identical-title": "error",
      "vitest/expect-expect": "error",
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
    },
  },

  // 0509#5785, shipped by 0509#5808. An e2e spec never waits on wall-clock time
  // or for the network to go idle, and never focuses or unconditionally skips a
  // test. `allowConditional` is the one non-default value: the suite gates on
  // the project and the environment (`test.skip(condition, reason)`), and report
  // specs use `test.fail()` (CLAUDE.md "Reproducing a user report").
  {
    files: ["e2e/**/*.ts"],
    plugins: { playwright },
    rules: {
      "playwright/no-focused-test": "error",
      "playwright/no-skipped-test": ["error", { allowConditional: true }],
      "playwright/no-wait-for-timeout": "error",
      "playwright/no-page-pause": "error",
      "playwright/missing-playwright-await": "error",
      "playwright/no-networkidle": "error",
      "playwright/valid-expect": "error",
    },
  },

  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "*.config.ts", "e2e/**/*.ts", "tests/**/*.ts", "public/index.html"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "no-inline-comments": "off",
      "no-warning-comments": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },

  {
    files: ["public/index.html"],
    plugins: {
      "static-home": {
        rules: {
          "no-font-preload": STATIC_HOME_FONT_PRELOAD,
        },
      },
    },
    languageOptions: {
      parser: STATIC_HOME_HTML_PARSER,
      parserOptions: { projectService: false },
    },
    rules: {
      "static-home/no-font-preload": "error",
    },
  },

  // The DESIGN.md colour gate (0509#5871). The parent issue says
  // `no-unregistered-classes`; the rule shipped in 4.7.0 is named
  // `no-unknown-classes`, so that is the name here. Both patterns open with
  // `(?:[^\s]*:)*` because a variant prefix is not always one word: this repo
  // writes `max-[859px]:`, `aria-[current=page]:` and `[&:hover]:`, and a
  // prefix pattern of `[a-z0-9-]+` let a banned colour hide behind all three.
  // The `ui/` ignore list covers stock shadcn semantic tokens and
  // tw-animate-css classes that are dead on main: the tokens are not in
  // `@theme`, and registering them would start painting, a design change out
  // of scope for this slice. 81 hits were probed on a74ad41 — 80 in
  // app/components/ui/, one `cf-turnstile` in
  // app/components/turnstile-widget.tsx, which is Cloudflare's widget class,
  // never a Tailwind class. The `ui/` override is a later matching block
  // because flat config replaces a rule's options per matching block: it
  // widens `no-unknown-classes` only, and the strict block's
  // restricted-classes and class-order settings stay in force there.
  {
    files: ["app/**/*.{ts,tsx}"],
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      "better-tailwindcss": { entryPoint: "app/app.css", variables: TAILWIND_CLASS_VARIABLES },
    },
    rules: {
      "better-tailwindcss/no-unknown-classes": ["error", { ignore: ["^cf-turnstile$"] }],
      "better-tailwindcss/no-restricted-classes": [
        "error",
        { restrict: [TAILWIND_ARBITRARY_COLOUR, TAILWIND_DEFAULT_PALETTE] },
      ],
      "better-tailwindcss/enforce-consistent-class-order": "error",
    },
  },
  {
    files: ["app/components/ui/**/*.tsx"],
    rules: {
      "better-tailwindcss/no-unknown-classes": [
        "error",
        { ignore: [SHADCN_STOCK_TOKEN_CLASSES, TW_ANIMATE_STOCK_CLASSES] },
      ],
    },
  },
);
