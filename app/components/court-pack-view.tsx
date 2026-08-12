import type { CourtPack } from "~/lib/court-pack";
export function CourtPackView({ pack }: { pack: CourtPack }) {
  return <section aria-label="Court Pack" className="court-pack" data-testid="court-pack">
    <header><p>Agency Court Pack</p><h2>{pack.roomName}</h2>{pack.clientLabel ? <p>{pack.clientLabel}</p> : null}{pack.branding?.brandLogo ? <img alt={pack.preparedBy ?? "Workspace logo"} src={pack.branding.brandLogo} /> : null}{pack.preparedBy ? <p>Prepared by {pack.preparedBy}</p> : null}</header>
    {pack.hasNothingToPack ? <div role="status"><h3>No approved reports yet</h3><p>Review and approve report evidence to prepare this Court Pack.</p></div> : null}
    {pack.plates.map((plate) => <article key={plate.reportId} data-testid={`court-pack-plate-${plate.plateNumber}`}><h3>Evidence plate {plate.plateNumber}: {plate.title}</h3>{plate.advertiser ? <p>{plate.advertiser}</p> : null}{plate.headline ? <p>{plate.headline}</p> : null}<p>{plate.proofStatusLabel}</p>{plate.sourceUrl ? <a href={plate.sourceUrl}>Source evidence</a> : null}</article>)}
    {pack.excluded.length ? <section aria-labelledby="court-pack-exclusions"><h3 id="court-pack-exclusions">Excluded from verified evidence</h3><ul>{pack.excluded.map((item) => <li key={`${item.reportId}-${item.reasonCode}`}>{item.resourceLabel ?? item.reportId}: {item.reason} ({item.reasonCode})</li>)}</ul></section> : null}
    <footer>Five to Nine · Read-only HTML for browser printing</footer>
  </section>;
}
