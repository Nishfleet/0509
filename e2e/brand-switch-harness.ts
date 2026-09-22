import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";

import { BrandSwitch } from "../app/components/brand-switch";

function Page() {
  const [kindred, setKindred] = useState<"on" | "off">("on");
  const [casetta, setCasetta] = useState<"on" | "off">("off");
  return createElement(
    "main",
    null,
    createElement("h1", null, "Per-brand switch"),
    createElement(BrandSwitch, {
      name: "Kindred",
      state: kindred,
      pausedOn: "22 Sep",
      onChange: setKindred,
    }),
    createElement(BrandSwitch, {
      name: "Casetta",
      state: casetta,
      pausedOn: "12 Sep",
      onChange: setCasetta,
    }),
    createElement(BrandSwitch, { name: "Loopwell", state: "you" }),
  );
}

function mountBrandSwitch(): void {
  const root = document.getElementById("root");
  if (root === null) throw new Error("brand-switch harness has no root");
  createRoot(root).render(createElement(Page));
}

if (typeof document !== "undefined") mountBrandSwitch();
