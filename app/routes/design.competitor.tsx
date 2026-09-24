import { useState } from "react";

import { CompetitorHeader, CompetitorSwitch } from "../components/competitor-header";

export default function Page() {
  const [state, setState] = useState<"on" | "off">("on");
  return (
    <main className="p-4">
      <CompetitorHeader
        name="Kindred"
        domain="kindred.example"
        state={state}
        stateChangedAt={null}
        control={
          <CompetitorSwitch
            state={state}
            brandName="Kindred"
            onCheckedChange={(checked) => {
              setState(checked ? "on" : "off");
            }}
          />
        }
      />
    </main>
  );
}
