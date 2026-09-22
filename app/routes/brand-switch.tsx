import { useState } from "react";

import { BrandSwitch } from "../components/brand-switch";

export function meta() {
  return [{ title: "Per-brand switch" }, { name: "robots", content: "noindex" }];
}

export default function Page() {
  const [kindred, setKindred] = useState<"on" | "off">("on");
  const [casetta, setCasetta] = useState<"on" | "off">("off");

  return (
    <main>
      <h1>Per-brand switch</h1>
      <BrandSwitch name="Kindred" state={kindred} pausedOn="22 Sep" onChange={setKindred} />
      <BrandSwitch name="Casetta" state={casetta} pausedOn="12 Sep" onChange={setCasetta} />
      <BrandSwitch name="Loopwell" state="you" />
    </main>
  );
}
