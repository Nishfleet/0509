import { describe, expect, it } from "vitest";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import interBoldRaw from "../../app/assets/fonts/Inter-Bold.ttf?raw";

function rawToBytes(raw: string): Uint8Array {
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i) & 0xff;
  return bytes;
}

describe("probe", () => {
  it("renders simple text with embedded font", async () => {
    await initWasm(resvgWasm);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
      <rect width="200" height="100" fill="#fff"/>
      <text x="10" y="50" fill="#000" font-size="30" font-family="Inter">HELLO</text>
    </svg>`;
    const r1 = new Resvg(svg, { fitTo: { mode: "original" } });
    const p1 = r1.render().asPng();
    const r2 = new Resvg(svg, {
      fitTo: { mode: "original" },
      font: { fontBuffers: [rawToBytes(interBoldRaw)], loadSystemFonts: false, defaultFontFamily: "Inter" },
    });
    const p2 = r2.render().asPng();
    expect(`noFont=${p1.length}|withFont=${p2.length}`).toBe("__SHOW__");
  });
});
