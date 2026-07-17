// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProviderObservationTimeField } from "~/components/provider-observation-time";

const originalTimezone = process.env.TZ;

beforeEach(() => {
  process.env.TZ = "Asia/Kolkata";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  process.env.TZ = originalTimezone;
  document.body.replaceChildren();
});

describe("ProviderObservationTimeField", () => {
  async function renderField() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          "form",
          null,
          createElement(ProviderObservationTimeField),
        ),
      );
    });

    return { container, root };
  }

  it("submits an unambiguous UTC instant from a non-UTC browser local time", async () => {
    const { container, root } = await renderField();

    try {
      const localInput = container.querySelector<HTMLInputElement>(
        'input[type="datetime-local"]',
      );
      expect(localInput).not.toBeNull();

      await act(async () => {
        if (!localInput) return;
        localInput.value = "2026-07-17T01:00";
        localInput.dispatchEvent(new Event("input", { bubbles: true }));
        localInput.dispatchEvent(new Event("change", { bubbles: true }));
      });

      const form = container.querySelector("form");
      expect(form).not.toBeNull();
      const submitted = new FormData(form ?? undefined);
      expect(submitted.get("observedAt")).toBe("2026-07-16T19:30:00.000Z");
      expect(submitted.get("observedAtLocal")).toBe("2026-07-17T01:00");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("keeps the UTC value in sync when the browser emits only change", async () => {
    const { container, root } = await renderField();

    try {
      const localInput = container.querySelector<HTMLInputElement>(
        'input[type="datetime-local"]',
      );
      expect(localInput).not.toBeNull();

      await act(async () => {
        if (!localInput) return;
        localInput.value = "2026-07-17T01:00";
        localInput.dispatchEvent(new Event("change", { bubbles: true }));
      });

      const submitted = new FormData(container.querySelector("form") ?? undefined);
      expect(submitted.get("observedAt")).toBe("2026-07-16T19:30:00.000Z");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
