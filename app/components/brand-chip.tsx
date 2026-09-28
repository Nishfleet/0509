import type { CSSProperties, ReactElement } from "react";
import { Link } from "react-router";

import { httpUrl } from "../lib/http-url";
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

function safeHref(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  return httpUrl(trimmed);
}

function safeLogo(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  return null;
}

function chipLabel(name: string, self: boolean, off: boolean): string {
  if (self && off) return `You · ${name} · off`;
  if (self) return `You · ${name}`;
  if (off) return `${name} · off`;
  return name;
}

function chipLink(href: string): ReactElement {
  if (href.startsWith("/")) return <Link to={href} prefetch="intent" />;
  return <a href={href} rel="noreferrer" />;
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

  const logo = safeLogo(logoUrl);
  const label = chipLabel(trimmed, self, off);

  return (
    <Badge
      variant="outline"
      render={chipLink(to)}
      data-self={self ? "" : undefined}
      data-off={off ? "" : undefined}
      className={cn(
        "h-auto max-w-full min-h-11 min-w-0 shrink gap-[7px] rounded-none border-[1.5px] border-line bg-card py-[5px] pr-[11px] pl-[5px] text-[0.85rem] font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        self && "border-ink font-semibold",
        off && "border-dashed text-ink-soft",
      )}
    >
      <Avatar
        aria-hidden="true"
        className={cn(
          "size-[26px] rounded-none after:rounded-none after:border-0",
          self ? "bg-green" : "bg-card",
          off ? "text-ink-faint" : "text-ink",
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
            "rounded-none border-[1.5px] font-display text-[0.8rem] font-extrabold",
            self ? "bg-green" : "bg-card",
            off ? "border-line text-ink-faint" : "border-ink text-ink",
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
      role="group"
    >
      {brands.map((brand, index) => (
        <BrandChip key={`${String(index)}:${brand.href}:${brand.name}`} {...brand} />
      ))}
      {add === null ? null : (
        <Badge
          variant="outline"
          render={chipLink(add)}
          className="h-auto min-h-11 rounded-none border-[1.5px] border-dashed border-line bg-transparent px-[11px] font-mono text-[0.7rem] tracking-[0.08em] text-ink-soft uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          + Add a competitor
        </Badge>
      )}
    </div>
  );
}
