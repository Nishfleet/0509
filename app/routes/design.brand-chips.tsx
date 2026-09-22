import { BrandChipRow, type BrandChipBrand } from "../components/brand-chip";

const brands: readonly BrandChipBrand[] = [
  { name: "Loopwell", href: "/app/competitors/loopwell", self: true },
  { name: "Kindred", href: "/app/competitors/kindred", logoUrl: "/brand-chip-kindred.svg" },
  { name: "Bramble", href: "/app/competitors/bramble", logoUrl: "/brand-chip-missing.png" },
  { name: "Fieldset", href: "/app/competitors/fieldset" },
  {
    name: "Northbeam International Holdings Group of the Northern Markets",
    href: "/app/competitors/northbeam",
  },
  { name: "Casetta", href: "/app/competitors/casetta", off: true },
];

export default function Page() {
  return (
    <main className="p-4">
      <BrandChipRow brands={brands} addHref="/onboarding" />
    </main>
  );
}
