import { useState } from "react";

import { BrandSwitch } from "../components/brand-switch";

export default function Page() {
  const [kindred, setKindred] = useState<"on" | "off">("on");
  const [casetta, setCasetta] = useState<"on" | "off">("off");

  return (
    <main className="p-4">
      {kindred === "off" ? (
        <BrandSwitch name="Kindred" state="off" pausedOn="22 Sep" onChange={setKindred} />
      ) : (
        <BrandSwitch name="Kindred" state="on" onChange={setKindred} />
      )}
      {casetta === "off" ? (
        <BrandSwitch name="Casetta" state="off" pausedOn="12 Sep" onChange={setCasetta} />
      ) : (
        <BrandSwitch name="Casetta" state="on" onChange={setCasetta} />
      )}
      <BrandSwitch name="Loopwell" state="you" />
    </main>
  );
}
