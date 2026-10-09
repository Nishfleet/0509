import { readdirSync } from "node:fs";

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
    'app/components/ ships to the browser; full zod costs about 13 KB gzipped per object schema there. Import from "zod/mini" instead (docs/REBUILD-STACK.md, zod). Source: 0509#4134.',
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

const ROW_EVIDENCE_STATIC_IMPORT = {
  name: "./row-evidence",
  message:
    'Load row-evidence with React.lazy(() => import("./row-evidence")), never a static import: a static import puts @base-ui/react/tabs in the /app entry (docs/REBUILD-DONE.md §B, 150 KB). Source: 0509#7014.',
};

const CHART_IMPORTS = [UPLOT_IMPORT, UPLOT_REACT_IMPORT, FOUR_WEEK_PLOT_STATIC_IMPORT];

const FAST_XML_PARSER_IMPORT = {
  name: "fast-xml-parser",
  message:
    "Feed XML is parsed only by @extractus/feed-extractor. A direct fast-xml-parser import is a second parser. Source: 0509#4051.",
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
    importNames: ["markDigestSentStatement", "markDigestFailed"],
    message: UNSCOPED_WRITER_MESSAGE,
  },
  {
    group: ["**/data/workspace.server"],
    importNames: ["deleteWorkspace"],
    message: UNSCOPED_WRITER_MESSAGE,
  },
];

const WORKFLOW_WITHMONITOR_IMPORT = {
  name: "@sentry/cloudflare",
  importNames: ["withMonitor"],
  message:
    "A Workflow run() replays after hibernation, so withMonitor around it opens Sentry check-ins that never close. Send captureCheckIn from withStepCheckIn inside step.do('monitor start') and step.do('monitor ok'). The Worker scheduled handler in workers/app.ts still uses withMonitor. Source: 0509#7001.",
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
// `.catch(() => null)` callback. The clause in
// app/lib/identity/name-cascade.server.ts logs via console.error before its
// `return null`, so it holds two statements and does not match this shape.
// Source: 0509#4462 (REBUILD-TRUST.md C1 Q1 — the D grade on PR #4457).
const CATCH_RETURNS_NULL = {
  selector: "CatchClause > BlockStatement[body.length=1] > ReturnStatement[argument.value=null]",
  message:
    "A catch whose only statement is `return null` swallows the error, so a thrown fetch or a bug fails as silently as a real 'not found'. Give the clause an error binding and a logged failure path (or rethrow). Source: 0509#4462.",
};

const SCORE_NAME = "/^(points|weight|multiplier|score|total)$/";

const RAW_SCORE_STRING = {
  selector: [
    `CallExpression[callee.name='String'][arguments.0.name=${SCORE_NAME}]`,
    `CallExpression[callee.name='String'][arguments.0.property.name=${SCORE_NAME}]`,
    "CallExpression[callee.name='String'] > BinaryExpression.arguments[operator='*']",
    `CallExpression[callee.property.name='toString'][callee.object.name=${SCORE_NAME}]`,
    `CallExpression[callee.property.name='toString'][callee.object.property.name=${SCORE_NAME}]`,
  ].join(", "),
  message:
    "String() on a score, weight, multiplier or computed product prints binary floating point to people: 3 × 0.6 showed as '1.7999999999999998 points' on the brand page. Format it with formatScore from app/lib/score-format.ts. Source: 0509#7206, commit 96ccfdf39 (docs/incidents/2026-10-06-raw-float-in-biggest-move.md).",
};

const MIN_H_11_ANCHOR = {
  selector:
    "JSXOpeningElement[name.name=/^(a|Link)$/] > JSXAttribute[name.name='className'] > Literal[value!=/min-h-11/]",
  message:
    "An interactive <a> or <Link> needs min-h-11 on its className string (44px tap target, DESIGN.md). Source: 0509#6591, 0509#6533.",
};

const FEED_STATE_LITERAL = {
  selector: "ObjectExpression > Property[key.name='feedState'][value.value=/^(ok|stale|error)$/]",
  message:
    "Only workers/sources/mentions/youtube.ts may build a YouTube feedState. commitYoutubeFeed accepts OkYoutubeFeed alone, so a stale or error feed cannot be stored as zero videos. Source: 0509#4051.",
};

const XML_PARSER_CONSTRUCTOR = {
  selector: "NewExpression[callee.name='XMLParser']",
  message:
    "Feed XML is parsed only by @extractus/feed-extractor. A second XMLParser is a second feed path. Source: 0509#4051.",
};

// The other half of the same gate, and the half that catches #7000.
// FAST_XML_PARSER_IMPORT and XML_PARSER_CONSTRUCTOR only catch a parser someone
// imported. The parser that actually sat beside the extractor until #7000
// imported nothing: it read tags with openTagAt()/elementAt() over indexOf and
// slices, and fed `item`, `entry` and `guid` to them as arguments. That is the
// shape a second feed parser has to have — you cannot read XML without naming a
// tag — so the ban is on naming a feed tag for a tag lookup at all, whether the
// name is a literal or a template. HTMLRewriter takes a CSS selector string, and
// the feed body goes through the extractor, so neither path needs to look a tag
// up by name.
//
// A literal spelling a feed tag is banned under app/lib/feeds/, which is where
// a second feed parser can only live. A bare "title" or "link" elsewhere in the
// repo is a DOM property, a JSON key or a column name, so the ban is scoped to
// the feed module and not applied repo-wide. The close-tag template covers the
// form that hides the name in a variable, which is how the deleted scanner
// found a close tag.
const HAND_ROLLED_FEED_TAG_SCAN = {
  selector:
    "Literal[value=/^(item|entry|items|channel|rss|feed|guid|pubdate)$/i], TemplateLiteral[quasis.0.value.raw=/^<\\//]",
  message:
    "Feed XML is read by @extractus/feed-extractor (app/lib/feeds/parse-feed.ts maps extractFromXml onto FeedItem) and a homepage <link> by one HTMLRewriter selector (app/lib/feeds/discover-feed.ts). Looking a feed tag up by name is a hand-rolled parser: one that imports nothing, so the fast-xml-parser import and XMLParser bans cannot see it, and one that must be re-audited against CDATA, entities, namespaces, case and hostile input forever. That is the parser #7000 deleted. The one tag name allowed here is dc:date, which the extractor does not surface; reach it through getExtraEntryFields as this file does, and add any other to the extractor instead. Source: 0509#7000.",
};

// The tag-reader helpers themselves. A function whose body slices a string at a
// tag offset is the scanner; banning the two shapes it was built from (a
// close-tag template, a lower-cased copy of a document) catches the same code
// before it is finished.
const HAND_ROLLED_TAG_READER = {
  selector:
    "CallExpression[callee.name=/^(openTagAt|elementAt|firstTag|findTag|parseTag|readTag|matchTag|unwrapCdata|stripTags|attributes)$/]",
  message:
    "A tag-reading helper is a hand-rolled parser. Feed XML is read by @extractus/feed-extractor and a homepage <link> by one HTMLRewriter selector (app/lib/feeds/discover-feed.ts). A local openTagAt/elementAt/stripTags/attributes has to re-derive CDATA, entities, namespaces and case, and the copy that sat beside the extractor for a year could not read RDF or dc:date. Source: 0509#7000.",
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
    "Outbound fetch is owned by app/lib/fetch/: fetchOutbound refuses non-public hosts and re-checks every redirect hop under an 8 s deadline, and cappedBody bounds the body. A bare fetch( anywhere else in server code is a second transport that drifts from all three. Client code is exempt: a browser fetch goes to our own origin and SSRF is a server-side risk. Source: 0509#4951, 0509#6212.",
};

// DESIGN.md: fonts are self-hosted. A Google Fonts <link> put LCP at 2021 ms against the
// 1500 ms budget (CI run 35635617508, main 5166ebb81; fixed in fd1457288).
const GOOGLE_FONTS_BAN = {
  selector:
    "Literal[value=/fonts\\.(googleapis|gstatic)\\.com/], TemplateElement[value.raw=/fonts\\.(googleapis|gstatic)\\.com/]",
  message:
    "Fonts are self-hosted (DESIGN.md). A Google Fonts link is render-blocking and broke the 1500 ms LCP budget once (fd1457288). Add the font file under public/ and an @font-face instead.",
};

const CRAWLER_USER_AGENT_BAN = {
  selector:
    "Literal[value=/FiveToNineBot\\/\\d|0509\\.io\\/\\d/], TemplateElement[value.raw=/FiveToNineBot\\/\\d|0509\\.io\\/\\d/]",
  message:
    "The crawler User-Agent is typed once, in app/lib/fetch/robots.server.ts as CRAWLER_USER_AGENT (built from ROBOTS_AGENT, the token robots.txt is matched against); every module that fetches today imports it. A second literal is a second identity to change and a fetch that silently keeps the old one, which is how the same identity came to be typed in more than one place. The version is matched as /\\d/ so a bump is this edit, not a new literal. Modules that fetch without a User-Agent at all are 0509#5960. Source: 0509#5883.",
};

const USER_DATA_NAME =
  "^(email|emails|userId|ip|input|raw|prompt|password|token|subject|term|url|urls|domain|registrable|slug|brandName|competitorName|displayName|robotsUrl|targetUrl)$";
// The one operator id the message allows, so `input.workspaceId` stays clean.
// Widen it only with a comment here naming why the new id is not user data.
const LOGGABLE_OPERATOR_ID = "workspaceId";
const LOG_OR_CAPTURE_CALL =
  "CallExpression:matches([callee.object.name='console'], [callee.name=/^(capture(Exception|Message|Event|Feedback)|set(Tag|Tags|Extra|Extras|Context|Attributes|User|ConversationId))$/], [callee.property.name=/^(capture(Exception|Message|Event|Feedback)|set(Tag|Tags|Extra|Extras|Context|Attributes|User|ConversationId))$/])";
const NO_USER_DATA_IN_LOGS_MESSAGE =
  "Logs and Sentry never carry customer data or prompt input: no email, user id, IP, raw input, prompt, subject, password, token, search term, URL, domain, slug or brand name, as a key, a value or a property read. Log the ids an operator needs (event, workspaceId) and an error message capped with .slice(0, 300). The selector matches names, so a renamed or aliased value is out of reach; review it. Privacy first (CLAUDE.md; workers/sentry.ts sendDefaultPii: false). Source: 0509#5776; term, URL, domain and slug added because name-cascade, resolve-domain, transport and robots logged the brand a customer typed and the competitor URLs they track (this PR).";
const NO_USER_DATA_IN_LOGS = [
  {
    selector: `${LOG_OR_CAPTURE_CALL} :matches(Property[key.name=/${USER_DATA_NAME}/], Property[value.name=/${USER_DATA_NAME}/], MemberExpression[property.name=/${USER_DATA_NAME}/])`,
    message: NO_USER_DATA_IN_LOGS_MESSAGE,
  },
  {
    selector: `${LOG_OR_CAPTURE_CALL} > Identifier.arguments[name=/${USER_DATA_NAME}/]`,
    message: NO_USER_DATA_IN_LOGS_MESSAGE,
  },
  // The first two cover a named key and a named value. These four close the
  // shapes the message promises but a name-only match misses: the `email` in
  // `console.log(`user ${email}`)`, the `subject` in `JSON.stringify(subject)`,
  // the `subject` in `{ ...subject }`, and the `subject` in
  // `console.log(subject.registrable)`. 0509#5786.
  {
    selector: `${LOG_OR_CAPTURE_CALL} TemplateLiteral > Identifier[name=/${USER_DATA_NAME}/]`,
    message: NO_USER_DATA_IN_LOGS_MESSAGE,
  },
  {
    selector: `${LOG_OR_CAPTURE_CALL} CallExpression > Identifier[name=/${USER_DATA_NAME}/]`,
    message: NO_USER_DATA_IN_LOGS_MESSAGE,
  },
  {
    selector: `${LOG_OR_CAPTURE_CALL} SpreadElement > Identifier[name=/${USER_DATA_NAME}/]`,
    message: NO_USER_DATA_IN_LOGS_MESSAGE,
  },
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

// docs/REBUILD-DONE.md D: "no test about the fleet, CI, migration numbering or
// docs — the feature-map proof test is the named exception". A unit test that
// opens a .md file checks copy against code, which is what review is for; a doc
// edit then fails the suite instead of the review, and the next writer learns
// to edit the test. 0509#6953 removed the three readers D named
// (tests/unit/coverage.test.ts and the two DESIGN.md gates in
// tests/unit/empty-state.test.ts) and lands this rule so the next one is a diff
// the lint rejects. The selector is the literal's value, so a path built from
// parts, a `new URL()` template or a name read from a config still slips
// through — this gate catches the shape that recurred, not every possible one.
const DOC_READING_TEST_BAN = {
  selector: "Literal[value=/\\.md$/]",
  message:
    "A test never reads a .md file. A doc-vs-code check is review's: a doc edit that fails the suite teaches the next writer to change the test instead of the doc. Put the copy in the product's public surface and assert that. docs/REBUILD-DONE.md D. Source: 0509#6953.",
};

const EMPTY_WORKERS_ENV_MOCK = {
  selector:
    "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock)$/][arguments.0.value='cloudflare:workers'] ObjectExpression[properties.length=1] > Property[key.name='env'] > ObjectExpression[properties.length=0]",
  message:
    "The node project already aliases cloudflare:workers to tests/workers-env-empty-stub.ts. An empty vi.mock({ env: {} }) is dead duplication; a test that needs values still mocks real bindings. Evals keep the throwing Proxy in tests/evals/workers-env-stub.ts. Source: 0509#7026.",
};

const ESLINT_DISK_PROBE_BAN = {
  selector:
    "CallExpression[callee.name=/^(writeFile|mkdir)(Sync)?$/], CallExpression[callee.property.name=/^(writeFile|mkdir)(Sync)?$/]",
  message:
    "ESLint rule tests lint in memory with lintText against a real filePath. Disk probes under app/ and workers/ collide when vitest runs files in parallel and leave stray files on a crash. Cross-file rules (import-x/no-cycle, boundaries) stay in tests/architecture-boundaries.test.ts. Source: 0509#7026.",
};

const BARE_TOAST = {
  selector: "CallExpression[callee.name='toast'], MemberExpression[object.name='toast']",
  message:
    "toast() is called in exactly one module, app/components/toaster.tsx, behind toastSaved(). DESIGN.md §11: toasts are only 'saved' and 'undo'. The sonner import ban does not catch a toast reached another way, so the call shape is banned too. Source: 0509#4116, 0509#7007.",
};

const HAND_ROLLED_ARIA_TAB = {
  selector:
    "JSXAttribute[name.name='role'] Literal[value=/^(tab|tablist|tabpanel)$/], JSXAttribute[name.name='role'] TemplateElement[value.raw=/^(tab|tablist|tabpanel)$/]",
  message:
    "Tabs come from app/components/ui/tabs.tsx (shadcn on @base-ui/react/tabs). A hand-rolled role=tab/tablist/tabpanel has no arrow keys and no roving tabIndex. Source: 0509#7014.",
};

const BANNED_SYNTAX = [
  HAND_ROLLED_ARIA_TAB,
  BARE_TOAST,
  SUPPORT_ADDRESS_BAN,
  GOOGLE_FONTS_BAN,
  CRAWLER_USER_AGENT_BAN,
  CATCH_RETURNS_NULL,
  RAW_SCORE_STRING,
  XML_PARSER_CONSTRUCTOR,
  DOMAIN_HOSTNAME_BAN,
  BARE_FETCH,
  {
    selector:
      "NewExpression[callee.name='RegExp'] > Literal.arguments, NewExpression[callee.name='RegExp'] > TemplateLiteral",
    message:
      "A regex built from a string cannot be shown to escape that string's metacharacters, so a '.' matches any host and an unexpected '\\' breaks the pattern. Two live alerts on 0509#4172 came from exactly this shape (CodeQL js/incomplete-hostname-regexp, 8 high alerts) plus a fan-out that probed once per match instead of once per board. Extract the candidate out of the text and parse it with `new URL()`, then match the hostname against a table with an exact comparison. Source: 0509#4172, commit sequence ending bdca157.",
  },
  {
    selector: "MemberExpression[object.name='context'][property.name='cloudflare']",
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
  'INSERT(\\s+OR\\s+\\w+)?\\s+INTO|REPLACE\\s+INTO|UPDATE\\s+[\\w".]+\\s+SET\\s+[\\w".]+\\s*=|DELETE\\s+FROM';

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

// The row shape comes from a schema, never from a type argument. `.first<T>()`,
// `.all<T>()`, `.raw<T>()`, `.run<T>()` and `.batch<T>()` each assert the row
// shape at compile time and check nothing at run time, so a row that does not
// match reaches the caller typed and wrong. The conversion children of #7031
// replaced them with a zod schema per row and z.infer for the type; this
// selector keeps the next one out. Armed in TABLE_WRITER_BLOCKS, not in a
// block of its own, so it survives the option-array replacement 0509#7266
// documents at the foot of this file.
const D1_ROW_TYPE_ARGUMENT = {
  selector:
    "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(first|all|raw|run|batch)$/][typeArguments]",
  message:
    "A D1 type argument asserts the row shape and is never checked. Parse the row with a zod schema in this writer file and derive the type with z.infer. Source: 0509#7027, 0509#7031.",
};

// 0509#7022: RAW_DML_WRITER only proves DML sits somewhere under
// app/lib/data/. Inside it, <table>.server.ts may write only <table>.
// One block per file, generated from the directory, so a new data file is
// guarded with no edit here. better-auth owns session and verification;
// auth_expiry is their one writer.
const TABLE_WRITER_ALLOWED_TABLES = { auth_expiry: ["session", "verification"] };

function foreignTableWriter(file) {
  const table = file.replace(/\.server\.ts$/, "");
  const allowed = TABLE_WRITER_ALLOWED_TABLES[table] ?? [table];
  const own = `(?:${allowed.join("|")})\\b`;
  // SQLite accepts `UPDATE OR <action> <table> SET ...` and
  // `UPDATE <table> AS <alias> SET ...`, so the table name itself — not the
  // word after UPDATE — is what the lookahead has to see.
  const UPDATE_HEAD = `\\bUPDATE\\s+(?:OR\\s+\\w+\\s+)?`;
  const UPDATE_TAIL = `(?:\\s+AS\\s+[\\w".]+)?\\s+SET\\s+[\\w".]+\\s*=`;
  const shape =
    `\\b(INSERT(\\s+OR\\s+\\w+)?\\s+INTO|REPLACE\\s+INTO|DELETE\\s+FROM)\\s+"?(?!${own})\\w` +
    `|${UPDATE_HEAD}"?(?!${own})[\\w.]+"?${UPDATE_TAIL}`;
  return {
    selector: `Literal[value=/${shape}/i], TemplateElement[value.raw=/${shape}/i]`,
    message: `Foreign-table write: app/lib/data/${file} may write only ${allowed.join(", ")}. Move this statement to app/lib/data/<its table>.server.ts as an exported function that returns a D1PreparedStatement, and put that in this file's env.DB.batch so the batch stays atomic. Source: 0509#7022.`,
  };
}

// A later matching block's no-restricted-syntax entry replaces the earlier
// one wholesale, so each block restates what data files already get.
export const TABLE_WRITER_BLOCKS = readdirSync(new URL("./app/lib/data/", import.meta.url))
  .filter((file) => file.endsWith(".server.ts"))
  .map((file) => ({
    files: [`app/lib/data/${file}`],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...BANNED_SYNTAX,
        ...NO_USER_DATA_IN_LOGS,
        FEED_STATE_LITERAL,
        D1_ROW_TYPE_ARGUMENT,
        foreignTableWriter(file),
      ],
    },
  }));

const ENV_DB_IN_ROUTES = {
  selector: "MemberExpression[object.name='env'][property.name='DB']",
  message:
    "Routes do not touch env.DB. Go through the one data layer in app/lib/data/. docs/REBUILD-TRUST.md C4. Source: 0509#6999 — the old CallExpression[callee...] selector matched only a direct env.DB(...) call, so the five routes passing env.DB as an argument linted green.",
};

const ENV_DB_DESTRUCTURE_IN_ROUTES = {
  selector: "VariableDeclarator[init.name='env'] > ObjectPattern > Property[key.name='DB']",
  message:
    "Routes do not touch env.DB, destructured or not. Go through the one data layer in app/lib/data/. Source: 0509#6999.",
};

const FORM_DATA_GET_BAN = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      formDataGet:
        "Parse form input with a zod schema next to the action; do not read formData.get by hand. The receiver is matched on its TypeScript type, so every FormData parameter or local is covered whatever it is called. Source: 0509#7027, 0509#7111.",
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (services?.getTypeAtLocation === undefined) {
      // A gate that silently passes every file it was armed for is the old
      // defect in a new costume, so a missing program is an error, not a
      // no-op. Nothing in this config can reach it: the rule is armed only on
      // app/** and workers/**, and every one of those files has type
      // information. 0509#7111.
      return {
        Program(node) {
          context.report({
            node,
            message: "form-rules/form-data-get needs TypeScript type information to match the receiver type.",
          });
        },
      };
    }
    return {
      MemberExpression(node) {
        if (node.optional) return;
        const name =
          node.property.type === "Identifier"
            ? node.property.name
            : node.property.type === "Literal" && typeof node.property.value === "string"
              ? node.property.value
              : null;
        // form["get"](...) is the only computed shape worth covering: any other
        // computed key is a dynamic read, not a field name.
        if (node.computed && node.property.type !== "Literal") return;
        if (name !== "get") return;
        if (!isFormData(services.getTypeAtLocation(node.object))) return;
        context.report({ node, messageId: "formDataGet" });
      },
    };
  },
};

function isFormData(type) {
  // FormData | undefined is pending UI (navigation.formData?.get) and
  // shouldRevalidate, not action input, so a union or an intersection is never
  // a hit.
  if (type.isUnion() || type.isIntersection()) return false;
  const seen = new Set();
  let current = type;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    if ((current.getSymbol() ?? current.aliasSymbol)?.getName() === "FormData") return true;
    // A hand-written FormData subclass still reads form input.
    const bases = current.getBaseTypes?.() ?? [];
    if (bases.length !== 1) return false;
    current = bases[0];
  }
  return false;
}

function isZodSchema(type) {
  const seen = new Set();
  const pending = [type];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    if (current.isUnion() || current.isIntersection()) {
      pending.push(...current.types);
      continue;
    }
    if ((current.getSymbol() ?? current.aliasSymbol)?.getName().startsWith("Zod")) return true;
    pending.push(...(current.getBaseTypes?.() ?? []));
  }
  return false;
}

// #7173: `zod`'s `.catch()` reads like a schema statement ("this row can be
// malformed") when what it does is "a row that violates the schema is silently
// repaired with a fallback". In app/lib/data/ — the one place that parses D1
// rows, and the place a reader of a writer learns what a row must look like —
// the two are the same characters. A row whose value no writer can produce is
// drift: it must reach the caller as a ZodError, not as a default. Arming this
// glob only, because a `.catch()` default on a request body or a feed config
// outside the data layer is a different contract and the rule cannot tell the
// two apart. Source: 0509#7173.
const ZOD_ROW_CATCH_BAN = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      zodRowCatch:
        "A row schema in app/lib/data/ is the row-parse contract: every row the SQL returns must meet it. `.catch(...)` silently repairs a row that violates it and substitutes a fallback, which hides the drift instead of reporting it. Parse with the true schema and let the ZodError reach the caller. docs/REBUILD-TRUST.md C1. Source: 0509#7173.",
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (services?.getTypeAtLocation === undefined) {
      // A gate that silently passes every file it was armed for is the old
      // defect in a new costume, so a missing program is an error, not a
      // no-op — the same shape form-rules/form-data-get reports. Nothing in
      // this config can reach it: the rule is armed on app/lib/data/**, where
      // every file has type information. 0509#7173.
      return {
        Program(node) {
          context.report({
            node,
            message: "row-rules/zod-row-catch needs TypeScript type information to match the receiver type.",
          });
        },
      };
    }
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        const name =
          callee.property.type === "Identifier"
            ? callee.property.name
            : callee.property.type === "Literal" && typeof callee.property.value === "string"
              ? callee.property.value
              : null;
        if (callee.computed && callee.property.type !== "Literal") return;
        if (name !== "catch") return;
        if (!isZodSchema(services.getTypeAtLocation(callee.object))) return;
        context.report({ node, messageId: "zodRowCatch" });
      },
    };
  },
};

const FORM_RULES_PLUGIN = {
  "form-rules": {
    rules: {
      "form-data-get": FORM_DATA_GET_BAN,
    },
  },
};

// #7299: D1_ROW_TYPE_ARGUMENT only rejects a type argument on `.first` /
// `.all` / `.raw` / `.run` / `.batch`. A writer can still return
// `await stmt.first()` with no type argument and no parse, which is the
// convention's first sentence unenforced. This rule requires a `.first` /
// `.all` / `.raw` result to be passed to a zod `.parse` / `.safeParse`
// before it leaves the function — either as a wrap
// (`schema.parse(await stmt.first())`) or as a later parse of the binding
// (`const row = await stmt.first(); return schema.parse(row)`). A bare
// `JSON.parse` / `Date.parse` wrap does not count. `.run()` and `.batch()`
// are out of scope even when RETURNING (0509#7299). `Promise.all` is not a
// D1 read. Armed as row-rules/d1-row-parse (not no-restricted-syntax) so
// TABLE_WRITER_BLOCKS cannot drop it the way a later matching
// no-restricted-syntax block would. Source: 0509#7299.
const D1_ROW_PARSE = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      d1RowParse:
        "A D1 read in app/lib/data/ must be parsed with a zod schema before the row leaves the function. `.first()`, `.all()` and `.raw()` return unchecked values; pass the result to `.parse()` or `.safeParse()` on a zod schema in the same function. `.run()` and `.batch()` are out of scope (0509#7299) and do not need a parse. Source: 0509#7299.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const services = sourceCode.parserServices;
    if (services?.getTypeAtLocation === undefined) {
      return {
        Program(node) {
          context.report({
            node,
            message: "row-rules/d1-row-parse needs TypeScript type information to match a zod parse.",
          });
        },
      };
    }
    function calleePropertyName(node) {
      if (node.type !== "CallExpression") return null;
      const callee = node.callee;
      if (callee.type !== "MemberExpression") return null;
      if (callee.computed && callee.property.type !== "Literal") return null;
      if (callee.property.type === "Identifier") return callee.property.name;
      if (callee.property.type === "Literal" && typeof callee.property.value === "string") {
        return callee.property.value;
      }
      return null;
    }
    function memberName(node) {
      if (node.type !== "MemberExpression") return null;
      if (node.property.type === "Identifier") return node.property.name;
      if (node.property.type === "Literal" && typeof node.property.value === "string") {
        return node.property.value;
      }
      return null;
    }
    function isPromiseAll(node) {
      if (calleePropertyName(node) !== "all") return false;
      const callee = node.callee;
      if (callee.type !== "MemberExpression") return false;
      const obj = callee.object;
      if (obj.type === "Identifier") return obj.name === "Promise";
      return memberName(obj) === "Promise";
    }
    function isZodParse(node) {
      const name = calleePropertyName(node);
      if (name !== "parse" && name !== "safeParse") return false;
      const callee = node.callee;
      if (callee.type !== "MemberExpression") return false;
      return isZodSchema(services.getTypeAtLocation(callee.object));
    }
    function wrappedInZodParse(node) {
      return sourceCode.getAncestors(node).some((ancestor) => isZodParse(ancestor));
    }
    function identifierNames(pattern) {
      if (pattern.type === "Identifier") return [pattern.name];
      if (pattern.type === "ObjectPattern") {
        return pattern.properties.flatMap((property) =>
          property.type === "Property" ? identifierNames(property.value) : [],
        );
      }
      if (pattern.type === "ArrayPattern") {
        return pattern.elements.flatMap((element) => (element === null ? [] : identifierNames(element)));
      }
      return [];
    }
    function bindingNames(callNode) {
      const parent = callNode.parent;
      if (parent?.type === "AwaitExpression" && parent.parent?.type === "VariableDeclarator") {
        return identifierNames(parent.parent.id);
      }
      if (parent?.type === "VariableDeclarator") {
        return identifierNames(parent.id);
      }
      if (parent?.type === "ArrayExpression") {
        const index = parent.elements.indexOf(callNode);
        const allCall = parent.parent;
        if (allCall === undefined || !isPromiseAll(allCall)) return [];
        let after = allCall.parent;
        if (after?.type === "AwaitExpression") after = after.parent;
        if (after?.type === "VariableDeclarator" && after.id.type === "ArrayPattern") {
          const element = after.id.elements[index];
          return element === null || element === undefined ? [] : identifierNames(element);
        }
      }
      return [];
    }
    function collectIdentifiers(node, names) {
      if (node === undefined || node === null) return;
      if (node.type === "Identifier") {
        names.add(node.name);
        return;
      }
      if (node.type === "MemberExpression") {
        collectIdentifiers(node.object, names);
        return;
      }
      if (node.type === "ArrayExpression") {
        for (const element of node.elements) collectIdentifiers(element, names);
        return;
      }
      if (node.type === "AwaitExpression" || node.type === "ChainExpression") {
        collectIdentifiers(node.argument ?? node.expression, names);
      }
    }
    const frames = [];
    function enterFrame() {
      frames.push({ parsedNames: new Set(), reads: [] });
    }
    function exitFrame() {
      const frame = frames.pop();
      for (const read of frame.reads) {
        if (read.names.some((name) => frame.parsedNames.has(name))) continue;
        context.report({ node: read.node, messageId: "d1RowParse" });
      }
    }
    return {
      "Program, FunctionDeclaration, FunctionExpression, ArrowFunctionExpression": enterFrame,
      "Program, FunctionDeclaration, FunctionExpression, ArrowFunctionExpression:exit": exitFrame,
      CallExpression(node) {
        const frame = frames.at(-1);
        if (isZodParse(node) && node.arguments[0] !== undefined) {
          collectIdentifiers(node.arguments[0], frame.parsedNames);
        }
        const name = calleePropertyName(node);
        if (name !== "first" && name !== "all" && name !== "raw") return;
        if (isPromiseAll(node)) return;
        if (wrappedInZodParse(node)) return;
        frame.reads.push({ node, names: bindingNames(node) });
      },
    };
  },
};

const ROW_RULES_PLUGIN = {
  "row-rules": {
    rules: {
      "zod-row-catch": ZOD_ROW_CATCH_BAN,
      "d1-row-parse": D1_ROW_PARSE,
    },
  },
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
        "The static home must not preload a font. A preload holds the headline paint until the face arrives, so simulated LCP misses the fleet Lighthouse budget (fleet-ops config/lighthouserc.json). The three faces stay on the @font-face rules with font-display: swap. Source: 0509#5580.",
      fontFace:
        "The static home must not declare @font-face in the document. A face that finishes before the headline is a simulated-LCP dependency and misses the fleet Lighthouse budget (fleet-ops config/lighthouserc.json). The three faces live in /home-faces.css. Source: 0509#5598.",
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
          script.includes('addEventListener("load"') && script.includes('faces.href = "/home-faces.css"');
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
      // Composite project-reference emit for tsconfig.test.json (0509#7073).
      ".tsbuild/**",
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
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "separate-type-imports" }],
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/only-throw-error": ["error", { allow: [{ from: "lib", name: "Response" }] }],
    },
  },

  {
    files: ["app/**/*.{ts,tsx}", "workers/**/*.ts"],
    plugins: { "react-hooks": reactHooks, "no-comments": noComments },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-comments/disallowComments": ["error", { allow: ["eslint", "global"] }],
      "no-inline-comments": "error",
      "no-warning-comments": ["error", { terms: WORKAROUND_TERMS, location: "anywhere" }],
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
    plugins: FORM_RULES_PLUGIN,
    rules: {
      "no-restricted-syntax": ["error", ...BANNED_SYNTAX, ...NO_USER_DATA_IN_LOGS, RAW_DML_WRITER, FEED_STATE_LITERAL],
      "form-rules/form-data-get": "error",
    },
  },

  {
    // app/lib/data/** is the only D1 row reader, so it is the only place a row
    // schema lives. `.catch(...)` on one silences the row-parse contract.
    // `row-rules/d1-row-parse` requires `.first` / `.all` / `.raw` to be
    // parsed with a zod schema before the row leaves the function. Armed on
    // this glob only: a `.catch()`
    // on a request body or a feed config parsed elsewhere is a different
    // contract and the rule cannot distinguish it from a row read, and a D1
    // read outside the data layer is already banned by ENV_DB_IN_ROUTES.
    // Source: 0509#7173, 0509#7299.
    files: ["app/lib/data/**/*.ts"],
    plugins: ROW_RULES_PLUGIN,
    rules: { "row-rules/zod-row-catch": "error", "row-rules/d1-row-parse": "error" },
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
        MIN_H_11_ANCHOR,
      ],
    },
  },

  {
    // The one domain normaliser: the identity engine. These files read `.hostname`
    // for a purpose that is not domain normalisation, so the shared selector is
    // restated without `DOMAIN_HOSTNAME_BAN`: the identity engine itself, a
    // public-host guard in the transport layer, the job-board host match, this
    // site's www variant and page-host display, the OAuth loopback redirect
    // allow-list, and the support worker's site-host allow. Every
    // other `.hostname` read in app/ or workers/ keeps the ban. This block
    // restates the list because a later matching block's no-restricted-syntax
    // entry replaces the earlier one wholesale (flat config never merges a rule's
    // option array). 0509#4371.
    files: [
      "app/lib/identity/**/*.{ts,tsx}",
      "app/lib/fetch/transport.server.ts",
      "app/lib/hiring/discover-board.server.ts",
      "app/lib/site/own-site.server.ts",
      "app/lib/agent/redirect-uri.ts",
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
    // Identity *.server.ts still exempts DOMAIN_HOSTNAME_BAN (the engine lives
    // here) and bans form-rules/form-data-get so confirm/card-draft cannot read
    // a FormData receiver by hand. card-fields.ts stays on the block above:
    // isDraftSave reads pending formData (FormData | undefined) for
    // shouldRevalidate, not action input. 0509#7027, 0509#7033, 0509#7111.
    files: ["app/lib/identity/**/*.server.ts"],
    plugins: FORM_RULES_PLUGIN,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...BANNED_SYNTAX.filter((rule) => rule !== DOMAIN_HOSTNAME_BAN),
        ...NO_USER_DATA_IN_LOGS,
        RAW_DML_WRITER,
        FEED_STATE_LITERAL,
      ],
      "form-rules/form-data-get": "error",
    },
  },

  {
    // BARE_FETCH is a server-side rule: a browser fetch goes to our own origin,
    // and SSRF needs a server making the request. Server code is app/lib/**,
    // app/routes/** (loaders and actions), *.server.ts and workers/**; the rest of
    // app/ (components, root, entries) is client and exempt. The array restates
    // the shared list because a later matching block's no-restricted-syntax entry
    // replaces the earlier one wholesale. 0509#4951, 0509#6212.
    ignores: ["app/lib/**", "app/routes/**", "app/**/*.server.ts", "app/components/footer.tsx"],
    files: ["app/**/*.{ts,tsx}"],
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
    // 44px tap-target anchors (min-h-11). Scoped to the interactive-anchor
    // surfaces that already carry the token (footer, competitor-page header,
    // identity-card, brand-switch, landing header, empty-state) so
    // sentence-inline anchors stay out by file list, not disable comments.
    // Footer is in the block above because that block is the last match for
    // footer.tsx (the support-address exemption). Flat config replaces
    // no-restricted-syntax wholesale, so this restates the client list.
    // Source: 0509#6591, 0509#6533.
    files: [
      "app/components/competitor-header.tsx",
      "app/components/identity-card.tsx",
      "app/components/brand-switch.tsx",
      "app/components/landing/header.tsx",
      "app/components/empty-state.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...BANNED_SYNTAX.filter((rule) => rule !== BARE_FETCH),
        ...NO_USER_DATA_IN_LOGS,
        RAW_DML_WRITER,
        FEED_STATE_LITERAL,
        MIN_H_11_ANCHOR,
      ],
    },
  },

  {
    // The one toast() call site, behind toastSaved(). It is client code, so
    // BARE_FETCH stays off as in the client block above. Flat config replaces
    // no-restricted-syntax wholesale, so this restates the list. 0509#7007.
    files: ["app/components/toaster.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...BANNED_SYNTAX.filter((rule) => rule !== BARE_FETCH && rule !== BARE_TOAST),
        ...NO_USER_DATA_IN_LOGS,
        RAW_DML_WRITER,
        FEED_STATE_LITERAL,
      ],
    },
  },

  {
    // The fetch paved path itself, where the guard's host check and the
    // wrapped call live by definition; its .hostname reads stay allowed too.
    files: ["app/lib/fetch/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...BANNED_SYNTAX.filter((rule) => rule !== BARE_FETCH && rule !== DOMAIN_HOSTNAME_BAN),
        ...NO_USER_DATA_IN_LOGS,
        RAW_DML_WRITER,
        FEED_STATE_LITERAL,
      ],
    },
  },

  {
    // The feed read itself. A second parser in here cannot be reached by the
    // import ban (it needs no import) or the whole-repo tag ban (a "title"
    // elsewhere is a DOM property), so the tag ban is scoped to the module a
    // feed parser can only live in. dc:date is the one name parse-feed.ts
    // reaches for through getExtraEntryFields, and it is excluded above; the
    // extractor does not surface it.
    files: ["app/lib/feeds/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...BANNED_SYNTAX,
        ...NO_USER_DATA_IN_LOGS,
        RAW_DML_WRITER,
        FEED_STATE_LITERAL,
        HAND_ROLLED_FEED_TAG_SCAN,
        HAND_ROLLED_TAG_READER,
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
    ignores: ["app/lib/auth.server.ts", "app/lib/auth-client.ts", "app/components/toaster.tsx"],
    rules: {
      "no-restricted-imports": ["error", { paths: ONE_PAVED_PATH_IMPORTS, patterns: PAVED_PATH_PATTERNS }],
    },
  },

  // Flat config replaces a rule's options wholesale, so this restates
  // ONE_PAVED_PATH_IMPORTS and PAVED_PATH_PATTERNS. Source: 0509#7001.
  {
    files: ["workers/workflows/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...ONE_PAVED_PATH_IMPORTS, WORKFLOW_WITHMONITOR_IMPORT],
          patterns: PAVED_PATH_PATTERNS,
        },
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
          paths: [
            ...ONE_PAVED_PATH_IMPORTS,
            CLOUDFLARE_WORKERS_IMPORT,
            FULL_ZOD_IMPORT,
            ...CHART_IMPORTS,
            ROW_EVIDENCE_STATIC_IMPORT,
          ],
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
                to: [{ element: { type: "component" } }, { file: { categories: "server-module" } }],
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
            {
              from: { element: { type: "data-writer" } },
              disallow: {
                to: [
                  { element: { type: "component" } },
                  { element: { type: "route" } },
                  { file: { categories: "route-module" } },
                ],
              },
              message:
                "The data layer returns rows, never view code: app/lib/data/** may not import app/components/** or app/routes/**. Move shared pure logic into app/lib/. Source: 0509#7027, 0509#7031.",
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
    plugins: FORM_RULES_PLUGIN,
    rules: {
      "max-lines": ["error", { max: 150, skipBlankLines: false, skipComments: false }],
      "no-restricted-syntax": [
        "error",
        ...BANNED_SYNTAX,
        ...NO_USER_DATA_IN_LOGS,
        RAW_DML_WRITER,
        ENV_DB_IN_ROUTES,
        ENV_DB_DESTRUCTURE_IN_ROUTES,
        FEED_STATE_LITERAL,
      ],
      "form-rules/form-data-get": "error",
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
      // Named assertion helpers: `expectNoHtmlInjection` is the 0509#7020
      // email-injection sweep helper (tests/email-html-injection.ts), named
      // exactly so an `expect`-prefixed helper that asserts nothing still
      // fails this rule. A new assertion helper must be added to this list.
      // `assert` stays from the stock default.
      "vitest/expect-expect": ["error", { assertFunctionNames: ["expect", "expectNoHtmlInjection", "assert"] }],
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      "no-restricted-syntax": ["error", EMPTY_WORKERS_ENV_MOCK],
    },
  },

  {
    files: ["tests/eslint-*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", EMPTY_WORKERS_ENV_MOCK, ESLINT_DISK_PROBE_BAN],
    },
  },

  {
    // docs/REBUILD-DONE.md D, 0509#6953. Scope is tests/unit/** — the three
    // readers D named were all unit tests, and it is what keeps the exception
    // list to exactly two. tests/stack-dependencies.test.ts and
    // tests/docs-paths.test.ts also read .md files, but they are repo-hygiene
    // gates on the agent's own entry docs rather than copy-versus-code checks
    // about the product, and CLAUDE.md makes the first a rejection rule ("a
    // dependency with no row in docs/dependencies.md is a rejection", moved out
    // of docs/REBUILD-STACK.md §9 by 0509#7017). Both
    // are follow-up work to migrate, not exemptions to add here.
    //
    // Two files hold a named exception and only these two, because Nish has not
    // ruled on either: feature-map-proof.test.ts reads
    // .agents/skills/verify/feature-map.md to prove every mapped screen was
    // actually visited, and theme.test.ts reads DESIGN.md §3 and §4 to keep the
    // tokens in step with the doc. A third is a new rule here, in review, not
    // an `ignores` entry. no-restricted-syntax is replaced, not merged, by the
    // last matching block, so this one repeats EMPTY_WORKERS_ENV_MOCK from the
    // tests/**/*.ts block above.
    files: ["tests/unit/**/*.ts"],
    ignores: ["tests/unit/feature-map-proof.test.ts", "tests/unit/theme.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", DOC_READING_TEST_BAN, EMPTY_WORKERS_ENV_MOCK],
    },
  },

  // 0509#5785, shipped by 0509#5808. An e2e spec never waits on wall-clock time
  // or for the network to go idle, and never focuses or unconditionally skips a
  // test. `allowConditional` is the one non-default value: the suite gates on
  // the project and the environment (`test.skip(condition, reason)`), and report
  // specs use `test.fail()` (CLAUDE.md "Reproducing a user report").
  // 0509#6138: a `test.use` fixture function must declare an object destructuring
  // pattern as its first parameter (Playwright rejects anything else), so
  // `async ({}, use, testInfo) => {}` is the form when no fixture is needed;
  // `allowObjectPatternsAsParameters` permits exactly that and nothing else.
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
      "no-empty-pattern": ["error", { allowObjectPatternsAsParameters: true }],
    },
  },

  // 0509#7229: e2e gets full strictTypeChecked. Number interpolation is the
  // one relaxation: a report label like `step ${i}` is safe and the #7183
  // comment named timeout numbers as the reason this rule was off. Every
  // other strictTypeChecked check applies to e2e specs.
  {
    files: ["e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },

  // 0509#7233: tests/** runs under strictTypeChecked. The named offs are the
  // findings typecheck cannot fix:
  // - vi.fn() mocks and JSON.parse results are `any`/`error` (no-unsafe-*).
  // - Test doubles declare `async` to match D1/fetch without awaiting a
  //   fixture (require-await).
  // - `cloudflare:test`'s `env` is @deprecated in favour of
  //   `cloudflare:workers` (2,571 of 2,578 no-deprecated hits).
  // - Partial loader/action args and mock shapes use `as` because `!` is
  //   banned (no-unnecessary-type-assertion,
  //   non-nullable-type-assertion-style).
  // - fetch spy args are `Request | string` (no-base-to-string).
  // - Workers `EmailMessage` types resolve as error in the test project
  //   (no-redundant-type-constituents).
  // - Tests mark unused bindings with `void x` (no-meaningless-void-operator).
  // - Handlers are cast off `worker.fetch` and `worker.email`, and `env.X.get`
  //   is asserted on as a spy (unbound-method).
  // - Send and fetch fixtures reject with the recorded value, including the
  //   non-Error string production `errorText` must stringify
  //   (prefer-promise-reject-errors).
  // Number and `any` interpolation is the same class as the e2e relaxation.
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-meaningless-void-operator": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true, allowAny: true }],
    },
  },

  // 0509#7073 / #7233: type-aware lint is on for e2e, tests and *.config.ts.
  // The comment exemption used to live on the disableTypeChecked block that
  // also listed those globs; keep it here so inline comments in specs,
  // configs and tests stay allowed (AGENTS.md: config files and tests are
  // exempt).
  {
    files: ["e2e/**/*.ts", "tests/**/*.ts", "*.config.ts"],
    rules: {
      "no-inline-comments": "off",
      "no-warning-comments": "off",
    },
  },

  // 0509#7233: tests/** is off disableTypeChecked. **/*.js, **/*.mjs,
  // **/*.cjs and public/index.html stay untyped.
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "public/index.html"],
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
  // The `ui/` ignore list keeps only the tw-animate-css classes (0509#7071):
  // the stock shadcn semantic tokens used to be ignored here too, on the false
  // premise that they were dead on main. They are not — DialogContent carries
  // `bg-popover` — so those tokens are now aliased onto the house palette in
  // app/app.css and this rule fails on any token without a mapping. tw-animate
  // is a separate package the app never imports, so its classes stay ignored.
  // The `ui/` override is a later matching block because flat config replaces a
  // rule's options per matching block: it widens `no-unknown-classes` only, and
  // the strict block's restricted-classes and class-order settings stay in force
  // there.
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
      "better-tailwindcss/no-unknown-classes": ["error", { ignore: [TW_ANIMATE_STOCK_CLASSES] }],
    },
  },

  // 0509#7266: TABLE_WRITER_BLOCKS must be the last entries in this array.
  // Flat config replaces a rule's options wholesale per matching block — a
  // later block with no-restricted-syntax on app/lib/data/** would silently
  // drop the per-file foreign-table-write selector. Spreading here guarantees
  // no existing block comes after them; a future block placed after this
  // comment overrides them by design and must restate every entry.
  ...TABLE_WRITER_BLOCKS,
);
