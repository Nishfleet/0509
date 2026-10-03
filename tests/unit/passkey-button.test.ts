import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import type * as ReactRouterModule from "react-router";
import type * as ButtonModule from "../../app/components/ui/button";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddPasskey } from "../../app/components/passkey-button";

const addPasskey = vi.hoisted(() => vi.fn());
const revalidate = vi.hoisted(() => vi.fn());
const button = vi.hoisted(() => ({ onClick: null as (() => void) | null, disabled: undefined as boolean | undefined }));

vi.mock("../../app/lib/auth-client", () => ({ authClient: { passkey: { addPasskey } } }));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<ReactRouterModule>();
  return { ...actual, useRevalidator: () => ({ revalidate, state: "idle" }) };
});

vi.mock("../../app/components/ui/button", async (importOriginal) => {
  const actual = await importOriginal<ButtonModule>();
  return {
    ...actual,
    Button: ({ onClick, children, ...rest }: { onClick?: () => void; children?: ReactNode }) => {
      button.onClick = onClick ?? null;
      button.disabled = rest.disabled;
      return createElement("button", { type: "button", onClick, ...rest }, children);
    },
  };
});

function render(): string {
  const router = createMemoryRouter([{ path: "/app/settings", element: createElement(AddPasskey) }], {
    initialEntries: ["/app/settings"],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

async function clickAndWaitAdded(): Promise<void> {
  render();
  button.onClick?.();
  await vi.waitFor(() => expect(addPasskey).toHaveBeenCalledTimes(1));
}

describe("AddPasskey", () => {
  beforeEach(() => {
    addPasskey.mockReset();
    revalidate.mockReset();
  });

  it("renders idle inside a router: the button is enabled and shows its idle label", () => {
    const html = render();
    expect(html).toContain("Add a passkey");
    expect(button.disabled).toBeFalsy();
    expect(addPasskey).not.toHaveBeenCalled();
  });

  it("revalidates the route loader after a successful add, so the new passkey shows without a reload", async () => {
    addPasskey.mockResolvedValue({ data: null, error: null });

    button.onClick?.();
    await vi.waitFor(() => expect(revalidate).toHaveBeenCalledTimes(1));
  });

  it("does not revalidate when better-auth answers with an error", async () => {
    addPasskey.mockResolvedValue({ data: null, error: { code: "ERROR_FAILED_TO_REGISTER" } });

    await clickAndWaitAdded();

    expect(revalidate).not.toHaveBeenCalled();
  });

  it("does not revalidate when the add call throws", async () => {
    addPasskey.mockRejectedValue(new Error("network"));

    await clickAndWaitAdded();

    expect(revalidate).not.toHaveBeenCalled();
  });
});
