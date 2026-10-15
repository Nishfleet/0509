import { useFetcher } from "react-router";

import { SUPPORT_ADDRESS } from "./footer";
import { BLOCK_HEADING } from "./page-heading";
import { clientBrandsFullLine } from "../lib/client-brands";
import { Button } from "./ui/button";

export interface BrandChoice {
  id: string;
  name: string;
  current: boolean;
}

function SwitchForm({ brand, label }: { brand: BrandChoice; label: string }) {
  return (
    <form method="post" action="/app/brands" className="max-w-full min-w-0">
      <input type="hidden" name="intent" value="switch" />
      <input type="hidden" name="workspaceId" value={brand.id} />
      <Button
        type="submit"
        variant="secondary"
        className="max-w-full py-2 text-left whitespace-normal [overflow-wrap:anywhere]"
      >
        {label}
      </Button>
    </form>
  );
}

function AddBrand() {
  const fetcher = useFetcher<{ message?: string }>();
  const adding = fetcher.state !== "idle";
  const message = fetcher.state === "idle" ? fetcher.data?.message : undefined;
  return (
    <fetcher.Form method="post" action="/app/brands" className="mt-6 flex max-w-prose flex-col gap-2">
      <input type="hidden" name="intent" value="add" />
      <label htmlFor="client-brand-name" className="font-semibold">
        Add a client brand
      </label>
      <input
        id="client-brand-name"
        name="name"
        type="text"
        maxLength={60}
        autoComplete="off"
        required
        aria-describedby={message ? "client-brand-error" : undefined}
        className="min-h-11 border-[1.5px] border-ink bg-card px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      />
      <Button type="submit" size="lg" className="self-start" disabled={adding}>
        {adding ? "Adding…" : "Add client brand"}
      </Button>
      <p id="client-brand-error" role="alert" className="leading-[1.55]">
        {message ?? null}
      </p>
    </fetcher.Form>
  );
}

function FullNote() {
  return (
    <p className="mt-6 max-w-prose leading-[1.55]">
      {clientBrandsFullLine()} Write to{" "}
      <a href={`mailto:${SUPPORT_ADDRESS}`} className="underline underline-offset-4">
        {SUPPORT_ADDRESS}
      </a>
    </p>
  );
}

export function ClientBrands({ brands, canAdd, full }: { brands: BrandChoice[]; canAdd: boolean; full: boolean }) {
  return (
    <section aria-labelledby="settings-brands" className="mt-10 border-t border-line pt-6">
      <h2 id="settings-brands" className={BLOCK_HEADING}>
        Client brands
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">
        Each client brand has its own competitors, alerts and weekly brief. They all ride on your Agency plan, with
        nothing extra to pay.
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {brands.map((brand) => (
          <li key={brand.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{brand.name}</span>
            {brand.current ? (
              <span className="font-mono text-meta text-ink-soft uppercase">Viewing now</span>
            ) : (
              <SwitchForm brand={brand} label={`Open ${brand.name}`} />
            )}
          </li>
        ))}
      </ul>
      {canAdd ? <AddBrand /> : null}
      {full ? <FullNote /> : null}
    </section>
  );
}

export function OtherBrands({ brands }: { brands: BrandChoice[] }) {
  if (brands.length === 0) return null;
  return (
    <aside aria-label="Your other brands" className="mt-10 flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <p className="text-body-sm text-ink-soft">Not now?</p>
      {brands.map((brand) => (
        <SwitchForm key={brand.id} brand={brand} label={`Back to ${brand.name}`} />
      ))}
    </aside>
  );
}
