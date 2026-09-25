import type { BriefPayload } from "./brief-payload";
import type { BriefSchedule } from "./brief-schedule";
import { nextBriefAt } from "./brief-schedule";
import { firstSiteSweepAt, nextSiteSweepAt } from "./onboarding/arrival-estimate";
export { nextSiteSweepAt, SITE_SWEEP_UTC_HOUR } from "./onboarding/arrival-estimate";

export interface HomeEntity {
  id: string;
  role: "self" | "competitor";
  domain: string;
  name: string;
  state: string;
}

export interface HomeHistoryRow {
  entity_id: string;
  week_start_at: string;
  rank: number;
}

export interface HomeSource { key: string; kind: "site" | "ads" | "mentions" | "hiring"; platform: string }

export interface HomeCount { entityId: string; sourceKey: string; count: number }

export interface HomeRow {
  entityId: string;
  position: number | null;
  name: string;
  domain: string | null;
  movement: string;
  self: boolean;
}

interface FourWeekLineSeries {
  entityId: string;
  label: string;
  self: boolean;
  paused: boolean;
  ranks: readonly (number | null)[];
}

export interface FourWeekChart {
  weeks: readonly string[];
  lines: readonly FourWeekLineSeries[];
}

export type HomeStanding =
  | { kind: "add-competitor" }
  | { kind: "gathering"; briefAt: string; firstSweepAt: string | null; brands: number }
  | { kind: "ranked"; rank: number; total: number; whyLine: string; readThisFirst: BriefPayload["read_this_first"]; rows: readonly HomeRow[]; chart: FourWeekChart };

export interface HomeChip {
  name: string;
  href: string;
  self: boolean;
  off: boolean;
}

export interface HomeView {
  eyebrow: string;
  greeting: string;
  standing: HomeStanding;
  chips: readonly HomeChip[];
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

function weekLabel(timezone: string, weekStartAt: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
  }).formatToParts(new Date(weekStartAt));
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${day} ${month}`.toUpperCase();
}

function weekKeys(history: readonly HomeHistoryRow[]): readonly string[] {
  return [...new Set(history.map((row) => row.week_start_at))].sort().slice(-4);
}

function fourWeekChart(
  history: readonly HomeHistoryRow[],
  rows: readonly HomeRow[],
  entities: readonly HomeEntity[],
  timezone: string,
): FourWeekChart {
  const weeks = weekKeys(history);
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
  const rowsByEntityId = new Map(rows.map((row) => [row.entityId, row]));
  const entityIds = [...new Set(history.map((row) => row.entity_id))];
  const ranksByEntityId = new Map(
    entityIds.map((entityId) => [
      entityId,
      weeks.map((week) => history.find((entry) => entry.entity_id === entityId && entry.week_start_at === week)?.rank ?? null),
    ]),
  );
  return {
    weeks: weeks.map((week) => weekLabel(timezone, week)),
    lines: entityIds.map((entityId) => {
      const entity = entitiesById.get(entityId);
      const row = rowsByEntityId.get(entityId);
      const self = entity?.role === "self";
      const label = self ? "YOU" : (row?.name ?? entity?.domain ?? entityId);
      const ranks = ranksByEntityId.get(entityId) ?? [];
      return { entityId, label, self, paused: entity?.state !== "on", ranks };
    }),
  };
}

export function homeStanding(input: {
  payload: BriefPayload | null;
  entities: readonly HomeEntity[];
  schedule: BriefSchedule;
  history: readonly HomeHistoryRow[];
  now: Date;
}): HomeStanding {
  const onBrands = input.entities.filter((entity) => entity.state === "on").length;
  if (onBrands < 2) return { kind: "add-competitor" };
  const payload = input.payload;
  const rank = payload?.headline_rank ?? null;
  if (payload === null || rank === null || payload.headline_total < 2) {
    return {
      kind: "gathering",
      briefAt: dayAndTime(input.schedule.timezone, nextBriefAt(input.schedule, input.now)),
      firstSweepAt: dayAndTime(input.schedule.timezone, nextSiteSweepAt(input.now)),
      brands: onBrands,
    };
  }
  const rows = rankedRows(payload, input.entities);
  return {
    kind: "ranked",
    rank,
    total: payload.headline_total,
    whyLine: payload.why_line,
    readThisFirst: payload.read_this_first.slice(0, 3),
    rows,
    chart: fourWeekChart(input.history, rows, input.entities, input.schedule.timezone),
  };
}

function chipHref(entity: HomeEntity): string {
  return entity.role === "self" ? "/app/settings" : `/app/competitors/${entity.id}`;
}

export function homeChips(entities: readonly HomeEntity[]): readonly HomeChip[] {
  const kept = entities.filter((entity) => entity.state === "on" || entity.state === "off");
  const self = kept.filter((entity) => entity.role === "self");
  const competitors = kept.filter((entity) => entity.role !== "self");
  return [...self, ...competitors].map((entity) => ({
    name: entity.name,
    href: chipHref(entity),
    self: entity.role === "self",
    off: entity.state === "off",
  }));
}

export function homeView(input: {
  payload: BriefPayload | null;
  entities: readonly HomeEntity[];
  schedule: BriefSchedule;
  history: readonly HomeHistoryRow[];
  sources: readonly HomeSource[];
  now: Date;
}): HomeView {
  const onCount = input.entities.filter((entity) => entity.state === "on").length;
  const brandWord = onCount === 1 ? "brand" : "brands";
  const recheckTime = hourAndMinute(input.schedule.timezone, nextHour(input.now));
  const briefTime = dayAndTime(input.schedule.timezone, nextBriefAt(input.schedule, input.now));
  const footer = `Checked ${String(onCount)} ${brandWord} this week · brief ${briefTime} · your site re-checked at ${recheckTime}`;
  const standing = homeStanding(input);
  const at = firstSiteSweepAt({ now: input.now, sources: input.sources });
  return {
    eyebrow: todayEyebrow(input.schedule.timezone, input.now),
    greeting: greetingFor(input.schedule.timezone, input.now),
    standing: standing.kind === "gathering" ? { ...standing, firstSweepAt: at === null ? null : dayAndTime(input.schedule.timezone, at) } : standing,
    chips: homeChips(input.entities),
    footer,
  };
}
