import { RowExpansion } from "../components/row-sheet";

export default function Page() {
  return (
    <main className="p-4">
      <h1>Row expansion</h1>
      <RowExpansion title="Kindred" summary="Kindred">
        detail
      </RowExpansion>
    </main>
  );
}
