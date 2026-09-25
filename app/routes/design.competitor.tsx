import { useState } from "react";

import { CompetitorHeader, CompetitorSwitch } from "../components/competitor-header";
import { DevelopmentsFeed } from "../components/developments-feed";
import type { DevelopmentItem } from "../lib/developments";

const ITEMS: readonly (DevelopmentItem & { when: string })[] = [
  {
    id: "dev-hiring-senior-brand-designer",
    kind: "hiring",
    title: "Senior brand designer",
    summary: null,
    url: null,
    observedAt: "2026-09-24T09:00:00.000Z",
    when: "24 Sept",
  },
  {
    id: "dev-change-homepage-headline",
    kind: "change",
    title: "Homepage headline changed",
    summary: null,
    url: null,
    observedAt: "2026-09-23T09:00:00.000Z",
    when: "23 Sept",
  },
  {
    id: "dev-ad-spring-sale",
    kind: "ad",
    title: "Spring sale creative",
    summary: null,
    url: null,
    observedAt: "2026-09-22T09:00:00.000Z",
    when: "22 Sept",
  },
  {
    id: "dev-mention-trade-roundup",
    kind: "mention",
    title: "Kindred named in a trade roundup",
    summary: null,
    url: null,
    observedAt: "2026-09-21T09:00:00.000Z",
    when: "21 Sept",
  },
  {
    id: "dev-hiring-growth-marketer",
    kind: "hiring",
    title: "Growth marketer",
    summary: "London · Marketing",
    url: null,
    observedAt: "2026-09-20T09:00:00.000Z",
    when: "20 Sept",
  },
  {
    id: "dev-change-pricing-page",
    kind: "change",
    title: "Pricing page changed",
    summary: null,
    url: null,
    observedAt: "2026-09-19T09:00:00.000Z",
    when: "19 Sept",
  },
  {
    id: "dev-ad-free-delivery",
    kind: "ad",
    title: "Free delivery headline",
    summary: null,
    url: null,
    observedAt: "2026-09-18T09:00:00.000Z",
    when: "18 Sept",
  },
];

export default function Page() {
  const [state, setState] = useState<"on" | "off">("on");
  return (
    <main className="flex min-w-0 flex-col gap-8 p-4">
      <CompetitorHeader
        name="Kindred"
        domain="kindred.example"
        state={state}
        stateChangedAt={null}
        control={
          <CompetitorSwitch
            state={state}
            brandName="Kindred"
            onCheckedChange={(checked) => {
              setState(checked ? "on" : "off");
            }}
          />
        }
      />
      <DevelopmentsFeed items={ITEMS} changes={[]} />
    </main>
  );
}
