import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = {
	user: {
		id: "owner-1",
		email: "owner@example.com",
		name: "Owner",
	},
	session: {
		id: "session-1",
		userId: "owner-1",
		expiresAt: "2026-07-17T00:00:00.000Z",
	},
};

function context() {
	return { cloudflare: { env: {} } };
}

function updateItemRequest() {
	const formData = new FormData();
	formData.set("intent", "update-item");
	formData.set("itemId", "item-404");
	formData.set("note", "updated note");
	formData.set("tags", "pricing, landing");
	return new Request("https://0509.io/app/collections", { method: "POST", body: formData });
}

function mockRoute(updateCollectionItem: ReturnType<typeof vi.fn>) {
	vi.doMock("~/lib/auth.server", () => ({
		requireWorkspaceSession: vi.fn().mockResolvedValue({
			session,
			workspaceUserId: "owner-1",
			isMember: false,
			ownerName: null,
		}),
	}));
	vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn((value) => value.cloudflare.env) }));
	vi.doMock("~/lib/data.server", () => ({
		addExternalProofToCollection: vi.fn(),
		createCollectionWithinLimit: vi.fn(),
		createShareLink: vi.fn(),
		getCollection: vi.fn(),
		listCollectionItems: vi.fn(),
		listCollections: vi.fn(),
		updateCollectionItem,
	}));
}

beforeEach(() => vi.resetModules());
afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("collections update-item action", () => {
	it("returns inline feedback for a missing item", async () => {
		const updateCollectionItem = vi
			.fn()
			.mockRejectedValue(new Error("Collection item not found."));
		mockRoute(updateCollectionItem);

		const { action } = await import("~/routes/app.collections");
		const result = await action({ context: context(), request: updateItemRequest() } as never);

		expect(result).toEqual({
			ok: false,
			intent: "update-item",
			itemId: "item-404",
			message: "We couldn't find that item. Refresh the page and try again.",
		});
		expect(updateCollectionItem).toHaveBeenCalledTimes(1);
	});

	it("resolves to inline confirmation for an existing item", async () => {
		const updateCollectionItem = vi.fn().mockResolvedValue(undefined);
		mockRoute(updateCollectionItem);

		const { action } = await import("~/routes/app.collections");
		const result = await action({ context: context(), request: updateItemRequest() } as never);

		expect(result).toEqual({
			ok: true,
			intent: "update-item",
			itemId: "item-404",
			message: "Collection note updated.",
		});
	});
});
