import type { BriefPayload } from "./brief-payload";
import type { BriefSchedule } from "./brief-schedule";
import { nextBriefAt } from "./brief-schedule";

export interface HomeEntity {
  id: string;
  role: "self" | "competitor";
  domain: string;
  state: string;
}

export interface HomeRow {
  entityId: string;
  position: number | null;
  name: string;
  domain: string | null;
  movement: string;
  self: boolean;
}

export type HomeStanding =
  | { kind: "add-competitor" }
  | { kind: "gathering"; briefAt: string }
  | { kind: "ranked"; rank: number; total: number; whyLine: string; rows: readonly HomeRow[] };

export interface HomeView {
  eyebrow: string;
  greeting: string;
  standing: HomeStanding;
  footer: string;
}

export function nextHour(now: Date): Date {
  return new Date((Math.floor(now.getTime() / 3_600_000) + 1) * 3_600_000);
}

const MOVEMENT = {
  new: "new",
  none: "first week",
  same: "holding steady",
  up: (count: number) => `up ${String(count)}`,
  down: (count: number) => `down ${String(count)}`,
};

export function movementLabel(movement: number | null, isNew: boolean): string {
  if (isNew) return MOVEMENT.new;
  if (movement === null) return MOVEMENT.none;
  if (movement > 0) return MOVEMENT.up(movement);
  if (movement < 0) return MOVEMENT.down(Math.abs(movement));
  return MOVEMENT.same;
}

function localHour(timezone: string, now: Date): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(now);
  return Number(hour);
}

export function greetingFor(timezone: string, now: Date): string {
  const hour = localHour(timezone, now);
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function hourAndMinute(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

function dayAndTime(timezone: string, at: Date): string {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "long" }).format(at);
  return `${day} ${hourAndMinute(timezone, at)}`;
}

function todayEyebrow(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
}

function byRank(a: HomeRow, b: HomeRow): number {
  if (a.position === b.position) return 0;
  if (a.position === null) return 1;
  if (b.position === null) return -1;
  return a.position - b.position;
}

function rankedRows(payload: BriefPayload, entities: readonly HomeEntity[]): readonly HomeRow[] {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  return payload.brands
    .map((brand) => {
      const entity = byId.get(brand.entity_id);
      const signals = brand.ad_delta + brand.mention_delta + brand.site_change_count + brand.new_roles;
      return {
        entityId: brand.entity_id,
        position: signals === 0 ? null : brand.rank,
        name: brand.name,
        domain: entity?.domain ?? null,
        movement: movementLabel(brand.movement, brand.is_new),
        self: entity?.role === "self",
      };
    })
    .sort(byRank);
}

export function homeStanding(input: {
  payload: BriefPayload | null;
  entities: readonly HomeEntity[];
  schedule: BriefSchedule;
  now: Date;
}): HomeStanding {
  const onBrands = input.entities.filter((entity) => entity.state === "on").length;
  if (onBrands < 2) return { kind: "add-competitor" };
  const payload = input.payload;
  const rank = payload?.headline_rank ?? null;
  if (payload === null || rank === null || payload.headline_total < 2) {
    return { kind: "gathering", briefAt: dayAndTime(input.schedule.timezone, nextBriefAt(input.schedule, input.now)) };
  }
  return {
    kind: "ranked",
    rank,
    total: payload.headline_total,
    whyLine: payload.why_line,
    rows: rankedRows(payload, input.entities),
  };
}

export function homeView(input: {
  payload: BriefPayload | null;
  entities: readonly HomeEntity[];
  schedule: BriefSchedule;
  now: Date;
}): HomeView {
  const onCount = input.entities.filter((entity) => entity.state === "on").length;
  const brandWord = onCount === 1 ? "brand" : "brands";
  const recheckTime = hourAndMinute(input.schedule.timezone, nextHour(input.now));
  const briefTime = dayAndTime(input.schedule.timezone, nextBriefAt(input.schedule, input.now));
  const footer = `Checked ${String(onCount)} ${brandWord} this week · brief ${briefTime} · your site re-checked at ${recheckTime}`;
  return {
    eyebrow: todayEyebrow(input.schedule.timezone, input.now),
    greeting: greetingFor(input.schedule.timezone, input.now),
    standing: homeStanding(input),
    footer,
  };
}
