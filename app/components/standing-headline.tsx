import type { HomeBrand } from "../lib/standing-present";

export function StandingHeadline({
  brands,
  why,
  whyIsJev,
  updatedSinceBrief,
  paused,
}: {
  brands: HomeBrand[];
  why: string | null;
  whyIsJev: boolean;
  updatedSinceBrief: boolean;
  paused: string[];
}) {
  if (brands.length === 0) return null;
  return (
    <section aria-label="Standing">
      <h2 title="ranked by what the internet did about each brand this week">This week</h2>
      <ol>
        {brands.map((brand) => (
          <li key={brand.entityId}>
            <span>{brand.rankLabel}</span> {brand.name} <span>{brand.movement}</span>{" "}
            <span>{brand.scoreLabel}</span>
          </li>
        ))}
      </ol>
      {why ? <p>{whyIsJev ? `Jev's read: ${why}` : why}</p> : null}
      {updatedSinceBrief ? <p>updated since your brief</p> : null}
      {paused.map((line, index) => (
        <p key={`${line}-${String(index)}`}>{line}</p>
      ))}
    </section>
  );
}
