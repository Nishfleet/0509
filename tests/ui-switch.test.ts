import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Switch } from "../app/components/ui/switch";

function render(props = {}) {
  return renderToStaticMarkup(createElement(Switch, props));
}

describe("ui/switch", () => {
  it("renders the switch slot and default size", () => {
    const html = render();
    expect(html).toContain('data-slot="switch"');
    expect(html).toContain('data-size="default"');
  });

  it("renders data-size=sm when size is sm", () => {
    const html = render({ size: "sm" });
    expect(html).toContain('data-size="sm"');
  });

  it("renders a thumb with the switch-thumb slot", () => {
    const html = render();
    expect(html).toContain('data-slot="switch-thumb"');
  });

  it("reflects disabled as data-disabled and the native disabled attribute", () => {
    const html = render({ disabled: true });
    expect(html).toContain('data-disabled=""');
    expect(html).toContain('disabled=""');
  });

  it("keeps a custom className alongside rounded-full", () => {
    const html = render({ className: "my-switch" });
    expect(html).toContain("my-switch");
    expect(html).toContain("rounded-full");
  });

  it("reflects checked via defaultChecked", () => {
    const html = render({ defaultChecked: true });
    expect(html).toContain("data-checked");
    expect(html).toContain('aria-checked="true"');
  });
});
