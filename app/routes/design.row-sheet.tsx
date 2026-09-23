import { RowSheet } from "../components/row-sheet";

const ROWS = [
  {
    id: "row-sheet-fixture-1",
    name: "Row sheet fixture 1",
    summary:
      "First of three rows on this fixture page. Below 860px a tap opens its sheet from the bottom; focus moves into the sheet and returns to this row on dismiss.",
  },
  {
    id: "row-sheet-fixture-2",
    name: "Row sheet fixture 2",
    summary:
      "A second row, so the page has more than one and a spec can prove each row owns its own sheet rather than a single shared popup.",
  },
  {
    id: "row-sheet-fixture-3",
    name: "Row sheet fixture 3",
    summary:
      "A third row for the open/dismiss/open/dismiss sequence the e2e spec drives across two rows. Motion is the DESIGN.md §9 budget by number.",
  },
];

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-[42rem] px-4 py-10">
      <p className="font-mono text-eyebrow uppercase text-ink-faint">Row sheet</p>
      <h1 className="font-display text-display-3 font-extrabold uppercase">
        The mobile row sheet
      </h1>

      <ul className="mt-6 list-none">
        {ROWS.map((row) => (
          <li key={row.id}>
            <RowSheet label={row.name}>
              <div className="flex flex-col gap-3 p-6">
                <h2 className="font-display text-title font-semibold">{row.name}</h2>
                <p className="text-body-sm text-ink-soft">{row.summary}</p>
              </div>
            </RowSheet>
          </li>
        ))}
      </ul>
    </main>
  );
}
