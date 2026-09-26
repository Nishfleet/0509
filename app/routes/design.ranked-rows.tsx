import type { Route } from "./+types/design.ranked-rows";
import { useSearchParams } from "react-router";

import { HomePageFrame, HomeStanding } from "../components/home-standing";
import type { HomeRow, HomeView, WeekEvidence } from "../lib/home-standing";

export function meta(_: Route.MetaArgs) {
  return [{ name: "robots", content: "noindex" }];
}

const ROWS: readonly HomeRow[] = [
  {
    entityId: "ent_kindred",
    position: 1,
    name: "Kindred",
    domain: "kindred.example",
    movement: "up 2",
    self: false,
    signals: 3,
    why: "Kindred launched 3 new ads",
    move: null,
    pills: [
      { key: "site.web", label: "Site site checks", count: 3, state: "live" },
      { key: "mentions.reddit", label: "Reddit mentions", count: 0, state: "degraded" },
    ],
  },
  {
    entityId: "ent_self",
    position: 2,
    name: "Loopwell",
    domain: "loopwell.example",
    movement: "holding steady",
    self: true,
    signals: 4,
    why: null,
    move: null,
    pills: [
      { key: "site.web", label: "Site site checks", count: 4, state: "live" },
      { key: "mentions.reddit", label: "Reddit mentions", count: 0, state: "none" },
    ],
  },
  {
    entityId: "ent_casetta",
    position: 3,
    name: "Casetta",
    domain: "casetta.example",
    movement: "first week",
    self: false,
    signals: 0,
    why: null,
    move: null,
    pills: [
      { key: "site.web", label: "Site site checks", count: 0, state: "none" },
      { key: "mentions.reddit", label: "Reddit mentions", count: 0, state: "none" },
    ],
  },
];

const EVIDENCE: readonly WeekEvidence[] = [
  {
    id: "sig_ev_1",
    sourceKind: "site",
    title: "Pricing page rewrote its hero",
    summary: null,
    url: "https://kindred.example/pricing",
    evidenceUrl: null,
    observedAt: "2026-09-20T10:00:00.000Z",
  },
  {
    id: "sig_ev_2",
    sourceKind: "site",
    title: null,
    summary: "Docs link added to the nav",
    url: null,
    evidenceUrl: null,
    observedAt: "2026-09-19T09:00:00.000Z",
  },
  {
    id: "sig_ev_3",
    sourceKind: "mentions",
    title: "Kindred mentioned on r/sysadmin",
    summary: null,
    url: "https://www.reddit.com/r/sysadmin/comments/abc",
    evidenceUrl: null,
    observedAt: "2026-09-18T08:00:00.000Z",
  },
];

const VIEW: HomeView = {
  eyebrow: "Thursday 24 September",
  greeting: "Good morning",
  standing: {
    kind: "ranked",
    rank: 2,
    total: 3,
    whyLine: "Kindred is the mover: 3 new ads",
    readThisFirst: [],
    rows: ROWS,
    chart: {
      weeks: ["31 AUG", "7 SEPT", "14 SEPT", "21 SEPT"],
      lines: [
        { entityId: "ent_self", label: "YOU", self: true, paused: false, ranks: [3, 3, 2, 2] },
        { entityId: "ent_kindred", label: "Kindred", self: false, paused: false, ranks: [2, 1, 1, 1] },
        { entityId: "ent_casetta", label: "Casetta", self: false, paused: false, ranks: [1, 2, 3, 3] },
      ],
    },
  },
  chips: [],
  footer: "Checked 3 brands this week · brief Monday 08:00 · your site re-checked at 07:00",
};

export default function Page() {
  const [searchParams] = useSearchParams();
  const open = searchParams.get("open");
  return (
    <HomePageFrame
      eyebrow={VIEW.eyebrow}
      footer={<p className="font-mono text-eyebrow text-ink-soft">{VIEW.footer}</p>}
    >
      <HomeStanding
        view={VIEW}
        showEyebrow={false}
        openId={open}
        evidence={open === null ? null : EVIDENCE}
      />
    </HomePageFrame>
  );
}
