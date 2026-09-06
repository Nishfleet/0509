import { describe, expect, it } from "vitest";

import { meterWidthClass } from "~/lib/meter-width";

describe("meterWidthClass", () => {
  it("renders exact integer percents", () => {
    expect(meterWidthClass(0)).toBe("f9-wk-meter-fill f9-wk-w0");
    expect(meterWidthClass(4)).toBe("f9-wk-meter-fill f9-wk-w4");
    expect(meterWidthClass(99)).toBe("f9-wk-meter-fill f9-wk-w99");
    expect(meterWidthClass(100)).toBe("f9-wk-meter-fill f9-wk-w100");
  });

  it("clamps out-of-range data", () => {
    expect(meterWidthClass(-10)).toBe("f9-wk-meter-fill f9-wk-w0");
    expect(meterWidthClass(250)).toBe("f9-wk-meter-fill f9-wk-w100");
  });

  it("a non-zero value never rounds to an invisible bar", () => {
    expect(meterWidthClass(0.2)).toBe("f9-wk-meter-fill f9-wk-w1");
  });

  it("continuous ratios round to the nearest exact percent", () => {
    expect(meterWidthClass((7 / 25) * 100)).toBe("f9-wk-meter-fill f9-wk-w28");
    expect(meterWidthClass(33.333)).toBe("f9-wk-meter-fill f9-wk-w33");
  });
});
