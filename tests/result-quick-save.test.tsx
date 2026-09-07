// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ResultQuickSave, type ResultQuickSaveProps } from "~/components/result-quick-save";

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) {
    const currentRoot = root;
    await act(async () => currentRoot.unmount());
  }
  root = null;
  container = null;
  document.body.replaceChildren();
});

const collections = [
  { id: "collection-1", name: "Nykaa competitors" },
  { id: "collection-2", name: "Later board" },
];

async function renderQuickSave(
  props: Partial<ResultQuickSaveProps>,
  searchAction: (args: { request: Request }) => Promise<unknown> = async () => ({ ok: true }),
) {
  const Stub = createRoutesStub([
    {
      path: "/search",
      action: searchAction,
      Component: () =>
        createElement(ResultQuickSave, {
          adId: "ad-1",
          advertiser: "Nykaa",
          plan: "starter",
          collections,
          ...props,
        }),
    },
  ]);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const currentRoot = root;
  await act(async () => {
    currentRoot.render(createElement(Stub, { initialEntries: ["/search"] }));
  });
  return container;
}

function button(view: HTMLElement) {
  return view.querySelector<HTMLButtonElement>(".f9-quick-save-button");
}

describe("ResultQuickSave", () => {
  it("submits save-to-collection for the first board and shows the saved state", async () => {
    const seen: Array<Record<string, string>> = [];
    const view = await renderQuickSave({}, async ({ request }) => {
      const formData = await request.formData();
      seen.push(Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)])));
      return { ok: true, message: "Saved Nykaa to your collection." };
    });

    await act(async () => {
      button(view)!.click();
    });
    await act(async () => {});

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      intent: "save-to-collection",
      adId: "ad-1",
      collectionId: "collection-1",
    });
    expect(button(view)!.textContent).toBe("Saved");
    expect(button(view)!.disabled).toBe(true);
  });

  it("recovers honestly from a failed save and allows retry", async () => {
    let attempts = 0;
    const view = await renderQuickSave({}, async () => {
      attempts += 1;
      return attempts === 1
        ? { ok: false, message: "That ad is no longer available to save. Select it again and retry." }
        : { ok: true };
    });

    await act(async () => {
      button(view)!.click();
    });
    await act(async () => {});

    expect(view.textContent).toContain("That ad is no longer available to save.");
    expect(button(view)!.disabled).toBe(false);
    expect(button(view)!.textContent).toBe("Retry save");

    await act(async () => {
      button(view)!.click();
    });
    await act(async () => {});
    expect(attempts).toBe(2);
    expect(button(view)!.textContent).toBe("Saved");
  });

  it("lets free users save into their included Collection like paid users", async () => {
    let submitted = false;
    const view = await renderQuickSave({ plan: "free", collections }, async () => {
      submitted = true;
      return { ok: true, message: "Saved Nykaa to your collection." };
    });

    await act(async () => {
      button(view)!.click();
    });
    await act(async () => {});

    expect(submitted).toBe(true);
    expect(button(view)!.textContent).toBe("Saved");
    expect(view.textContent).not.toContain("Upgrade to Scout");
  });

  it("shows the honest create-first note for free users without their 1 Collection instead of submitting", async () => {
    let submitted = false;
    const view = await renderQuickSave({ plan: "free", collections: [] }, async () => {
      submitted = true;
      return { ok: true };
    });

    await act(async () => {
      button(view)!.click();
    });

    expect(submitted).toBe(false);
    expect(view.textContent).toContain(
      "Free includes 1 Collection — create it in the Library to save ads.",
    );
    const library = view.querySelector<HTMLAnchorElement>('a[href="/app/collections"]');
    expect(library?.textContent).toBe("Open the Library");
  });

  it("renders nothing for paid users without a board yet", async () => {
    const view = await renderQuickSave({ collections: [] });
    expect(button(view)).toBeNull();
  });
});
