import type { CSSProperties, ReactElement } from "react";

import { cn } from "../lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Badge } from "./ui/badge";

const BOX = 26;

const boxStyle: CSSProperties = {
  width: BOX,
  height: BOX,
  minWidth: BOX,
  minHeight: BOX,
};

export interface BrandChipBrand {
  name: string;
  href: string;
  logoUrl?: string | null;
  self?: boolean;
  off?: boolean;
}

export function brandMonogram(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") return "";
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed);
  const first = segments[Symbol.iterator]().next().value;
  if (first === undefined) return "";
  return first.segment.toLocaleUpperCase();
}

function httpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function safeHref(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  return httpUrl(trimmed);
}

function safeLogo(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  return httpUrl(trimmed);
}

function chipLabel(name: string, self: boolean, off: boolean): string {
  if (self) return `You · ${name}`;
  if (off) return `${name} · off`;
  return name;
}

export function BrandChip({
  name,
  href,
  logoUrl,
  self = false,
  off = false,
}: BrandChipBrand): ReactElement | null {
  const trimmed = name.trim();
  const monogram = brandMonogram(trimmed);
  const to = safeHref(href);
  if (trimmed === "" || monogram === "" || to === null) return null;

  const you = self;
  const paused = off && !you;
  const logo = safeLogo(logoUrl);
  const label = chipLabel(trimmed, you, paused);

  return (
    <Badge
      variant="outline"
      render={<a href={to} />}
      data-self={you ? "" : undefined}
      data-off={paused ? "" : undefined}
      className={cn(
        "h-auto max-w-full min-h-11 min-w-0 shrink gap-[7px] rounded-none border-[1.5px] border-line bg-card py-[5px] pr-[11px] pl-[5px] text-[0.85rem] font-medium text-ink",
        you && "border-ink font-semibold",
        paused && "border-dashed text-ink-faint",
      )}
    >
      <Avatar
        aria-hidden="true"
        className={cn(
          "size-[26px] rounded-none after:rounded-none after:border-0",
          you ? "bg-accent text-ink" : "bg-card text-ink",
          paused && "text-ink-faint",
        )}
        style={boxStyle}
      >
        {logo === null ? null : (
          <AvatarImage
            alt=""
            className="absolute inset-0 size-full rounded-none object-cover data-error:hidden"
            height={BOX}
            keepMounted
            src={logo}
            width={BOX}
          />
        )}
        <AvatarFallback
          className={cn(
            "rounded-none border-[1.5px] border-ink bg-card font-display text-[0.8rem] font-extrabold text-ink",
            you && "border-ink bg-accent text-ink",
            paused && "border-line bg-card text-ink-faint",
          )}
        >
          {monogram}
        </AvatarFallback>
      </Avatar>
      <span className="block min-w-0 truncate">{label}</span>
    </Badge>
  );
}

export function BrandChipRow({
  brands,
  addHref,
}: {
  brands: readonly BrandChipBrand[];
  addHref?: string;
}): ReactElement {
  const add = addHref === undefined ? null : safeHref(addHref);
  return (
    <div
      aria-label="Your set"
      className="flex w-full min-w-0 max-w-full flex-wrap gap-2"
      data-slot="brand-chip-row"
    >
      {brands.map((brand, index) => (
        <BrandChip key={`${String(index)}:${brand.href}:${brand.name}`} {...brand} />
      ))}
      {add === null ? null : (
        <a
          className="inline-flex min-h-11 items-center rounded-none border-[1.5px] border-dashed border-line px-[11px] font-mono text-[0.7rem] tracking-[0.08em] text-ink-soft uppercase"
          href={add}
        >
          + Add a competitor
        </a>
      )}
    </div>
  );
}
