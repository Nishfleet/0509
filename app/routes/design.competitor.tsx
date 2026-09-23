import { CompetitorFrame } from "../components/competitor-frame";
import { CompetitorHeader } from "../components/competitor-header";

export default function Page() {
  return (
    <main className="mx-auto flex max-w-[1200px] min-w-0 flex-col gap-10 p-4">
      <CompetitorHeader
        name="Kindred"
        domain="kindred.example"
        state="on"
        stateChangedAt={null}
      />
      <CompetitorFrame />
    </main>
  );
}
