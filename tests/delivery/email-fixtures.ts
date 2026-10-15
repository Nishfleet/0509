import { parseBriefPayload, type BriefPayload } from "../../app/lib/brief-payload";
import { magicLinkEmail } from "../../app/lib/auth/magic-link-email";
import { changeEmailEmail } from "../../app/lib/auth/change-email-email";
import { teammateInviteEmail, verifyAddressEmail } from "../../app/lib/verify-address-email";
import { renderBrief } from "../../workers/delivery/brief-template";
import { renderChange, renderChangeOverflow } from "../../workers/delivery/change-template";
import { renderIncidentFixed, renderIncidentOpen } from "../../workers/delivery/incident-template";
import { renderMonthly } from "../../workers/delivery/monthly-template";
import { renderRecap } from "../../workers/delivery/recap-template";
import { renderRivalNudge } from "../../workers/delivery/rival-nudge-template";
import { renderTrialEnding } from "../../workers/delivery/trial-template";
import { renderWelcome } from "../../workers/delivery/welcome-template";
import { renderWinback } from "../../workers/delivery/winback-template";

export interface LifecycleEmail {
  readonly name: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly links: readonly string[];
  readonly fallbackAddress: boolean;
}

const UNSUBSCRIBE = "https://0509.io/u/opaque-token";
const SETTINGS = "https://0509.io/app/settings";
const HOME = "https://0509.io/app";
const OPEN = "https://0509.io/app/brief";
const ALERTS = "https://0509.io/app/alerts";
const COMPETITORS = "https://0509.io/app/competitors";
const FOOTER = { unsubscribe_url: UNSUBSCRIBE, settings_link: SETTINGS };

function briefPayload(overrides: Partial<BriefPayload> = {}): BriefPayload {
  return parseBriefPayload(
    JSON.stringify({
      workspace_id: "ws_1",
      timezone: "America/New_York",
      period_start: "2026-09-14T12:00:00.000Z",
      period_end: "2026-09-21T12:00:00.000Z",
      headline_rank: 3,
      headline_total: 8,
      headline_movement: 2,
      headline_is_new: false,
      why_line: "Kindred is the mover: 3 new ads and the loudest mention spike",
      is_quiet_week: false,
      is_unjudged: false,
      read_this_first: [
        {
          signal_id: "sig_1",
          entity_id: "ent_kindred",
          entity_name: "Kindred",
          title: "Pricing page rewritten",
          source: "site change",
          observed_at: "2026-09-16T15:30:00.000Z",
          thumbnail_r2_key: "captures/ws_1/sig_1/before.png",
          url: "https://kindred.example/pricing",
          before: "3 tiers",
          after: "2 tiers",
          jev_reason: "A competitor dropping a tier before launch week is the move.",
        },
      ],
      brands: [
        {
          entity_id: "ent_kindred",
          name: "Kindred",
          rank: 1,
          movement: 3,
          is_new: false,
          biggest_move: "dropped a pricing tier",
          ad_delta: 3,
          mention_delta: 12,
          site_change_count: 1,
          new_roles: 2,
        },
        {
          entity_id: "ent_self",
          name: "Five to Nine",
          rank: 3,
          movement: 2,
          is_new: false,
          biggest_move: null,
          ad_delta: 0,
          mention_delta: 4,
          site_change_count: 2,
          new_roles: 0,
        },
      ],
      own_site: { status: "ok", incidents: [] },
      checked: {
        mention_count: 61,
        site_change_count: 14,
        new_ad_count: 9,
        source_keys: ["meta", "google_news", "ddg"],
        degraded_source_keys: [],
        degraded_sources: [],
      },
      next_brief_at: "2026-09-28T12:00:00.000Z",
      ...overrides,
    }),
  );
}

function email(
  name: string,
  rendered: { subject: string; html: string; text: string },
  links: readonly string[],
  fallbackAddress = false,
): LifecycleEmail {
  return { name, ...rendered, links, fallbackAddress };
}

export function lifecycleEmails(): readonly LifecycleEmail[] {
  const base = { unsubscribe_url: UNSUBSCRIBE, asset_base_url: "https://assets.0509.io" };
  const owner = { ...base, open_url: OPEN };
  const teammate = { ...base, open_url: null };
  return [
    email(
      "magicLinkEmail",
      magicLinkEmail({ email: "ada@example.com", url: "https://0509.io/api/auth/magic?t=abc" }),
      ["https://0509.io/api/auth/magic?t=abc"],
      true,
    ),
    email(
      "changeEmailEmail approve",
      changeEmailEmail({ kind: "approve", email: "ada@new.example", url: "https://0509.io/api/auth/verify?t=abc" }),
      ["https://0509.io/api/auth/verify?t=abc"],
      true,
    ),
    email(
      "changeEmailEmail confirm",
      changeEmailEmail({ kind: "confirm", email: "ada@new.example", url: "https://0509.io/api/auth/verify?t=def" }),
      ["https://0509.io/api/auth/verify?t=def"],
      true,
    ),
    email(
      "verifyAddressEmail",
      verifyAddressEmail({ email: "ada@example.com", url: "https://0509.io/v/tok" }),
      ["https://0509.io/v/tok"],
      true,
    ),
    email(
      "teammateInviteEmail",
      teammateInviteEmail({ email: "bo@example.com", url: "https://0509.io/v/tok", addedBy: "Ada" }),
      ["https://0509.io/v/tok"],
      true,
    ),
    email(
      "renderWelcome",
      renderWelcome({
        rivals: ["Acme", "Globex"],
        rival_count: 5,
        first_brief_at: "2026-10-19T08:00:00.000Z",
        timezone: "UTC",
        home_link: HOME,
      }),
      [HOME],
    ),
    email(
      "renderTrialEnding",
      renderTrialEnding({
        plan: "Starter",
        monthly_price_eur: 46,
        ends_at: "2026-10-21T08:00:00.000Z",
        timezone: "UTC",
        link: SETTINGS,
      }),
      [SETTINGS],
    ),
    email(
      "renderChange",
      renderChange({
        headline: "Kindred changed its pricing",
        observed_at: "2026-10-14T08:30:00.000Z",
        mark: { removed: "Pro €29", added: "Pro €39" },
        link: "https://0509.io/app/alerts/sig_1",
        timezone: "UTC",
        ...FOOTER,
      }),
      ["https://0509.io/app/alerts/sig_1"],
    ),
    email("renderChangeOverflow", renderChangeOverflow({ cap: 5, link: ALERTS, ...FOOTER }), [ALERTS]),
    email(
      "renderRecap",
      renderRecap({
        change_count: 3,
        latest: { rival: "Kindred", what: "changed its pricing page" },
        standing: [],
        link: ALERTS,
        footer: FOOTER,
      }),
      [ALERTS],
    ),
    email(
      "renderRecap, one change and no latest",
      renderRecap({ change_count: 1, latest: null, standing: [], link: ALERTS, footer: FOOTER }),
      [ALERTS],
    ),
    email(
      "renderRecap, nothing changed and where rivals stand",
      renderRecap({
        change_count: 0,
        latest: null,
        standing: [{ rival: "Kindred", lines: ["In its own words: Invoices for freelancers"] }],
        link: ALERTS,
        footer: FOOTER,
      }),
      [ALERTS],
    ),
    email(
      "renderMonthly",
      renderMonthly({
        month: "September",
        change_count: 7,
        moves: [
          { rival: "Kindred", what: "changed its pricing page" },
          { rival: "Acme", what: "rewrote its homepage headline" },
        ],
        link: ALERTS,
        footer: FOOTER,
      }),
      [ALERTS],
    ),
    email(
      "renderMonthly, one change and no moves",
      renderMonthly({ month: "September", change_count: 1, moves: [], link: ALERTS, footer: FOOTER }),
      [ALERTS],
    ),
    email(
      "renderWinback",
      renderWinback({
        change_count: 3,
        latest: { rival: "Kindred", what: "changed its pricing page" },
        link: ALERTS,
        footer: FOOTER,
      }),
      [ALERTS],
    ),
    email(
      "renderWinback, one change and no latest",
      renderWinback({ change_count: 1, latest: null, link: ALERTS, footer: FOOTER }),
      [ALERTS],
    ),
    email(
      "renderRivalNudge, one rival",
      renderRivalNudge({ rivals: 1, rival_name: "Kindred", link: COMPETITORS, footer: FOOTER }),
      [COMPETITORS],
    ),
    email(
      "renderRivalNudge, no rival",
      renderRivalNudge({ rivals: 0, rival_name: null, link: COMPETITORS, footer: FOOTER }),
      [COMPETITORS],
    ),
    email(
      "renderIncidentOpen",
      renderIncidentOpen({
        site: "shop.example",
        kind: "pricing section missing",
        opened_at: "2026-10-14T04:52:00.000Z",
        recheck_at: "2026-10-14T05:52:00.000Z",
        mark: "Pricing heading present, then absent",
        link: "https://0509.io/app/alerts/inc_1",
        timezone: "UTC",
        ...FOOTER,
      }),
      ["https://0509.io/app/alerts/inc_1"],
    ),
    email(
      "renderIncidentFixed",
      renderIncidentFixed({
        site: "shop.example",
        kind: "pricing section missing",
        closed_at: "2026-10-14T05:52:00.000Z",
        link: "https://0509.io/app/alerts/inc_1",
        timezone: "UTC",
        ...FOOTER,
      }),
      ["https://0509.io/app/alerts/inc_1"],
    ),
    email("renderBrief", renderBrief(briefPayload(), owner), [OPEN]),
    email(
      "renderBrief quiet week",
      renderBrief(
        briefPayload({
          is_quiet_week: true,
          read_this_first: [],
          why_line: "Nothing needed your attention this week.",
        }),
        owner,
      ),
      [OPEN],
    ),
    email("renderBrief teammate copy", renderBrief(briefPayload(), teammate), []),
  ];
}
