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

function externalProofRequest() {
	const formData = new FormData();
	formData.set("intent", "add-external-proof");
	formData.set("collectionId", "collection-1");
	formData.set("advertiser", "Acme");
	formData.set("proofUrl", "https://example.com/proof");
	formData.set("channel", "Other");
	formData.set("observedAt", "2026-07-15");
	return new Request("https://0509.io/app/collections", { method: "POST", body: formData });
}

function mockRoute(addExternalProofToCollection: ReturnType<typeof vi.fn>) {
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
		addExternalProofToCollection,
		createCollectionWithinLimit: vi.fn(),
		createShareLink: vi.fn(),
		getCollection: vi.fn(),
		listCollectionItems: vi.fn(),
		listCollections: vi.fn(),
		renameCollection: vi.fn(),
		updateCollectionItem: vi.fn(),
	}));
}

beforeEach(() => vi.resetModules());
afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("collections external-proof action", () => {
	it("returns sanitized inline feedback for a customer-facing 4xx Response", async () => {
		const addExternalProofToCollection = vi
			.fn()
			.mockRejectedValue(new Response("D1_ERROR: invalid proof URL", { status: 422 }));
		mockRoute(addExternalProofToCollection);

		const { action } = await import("~/routes/app.collections");
		const result = await action({ context: context(), request: externalProofRequest() } as never);

		expect(result).toEqual({
			ok: false,
			intent: "add-external-proof",
			message: "This feature is temporarily unavailable. Try again later.",
		});
		expect(addExternalProofToCollection).toHaveBeenCalledTimes(1);
	});

	it("rethrows non-4xx failures so unexpected errors reach route error handling", async () => {
		const failure = new Error("provider exploded");
		const addExternalProofToCollection = vi.fn().mockRejectedValue(failure);
		mockRoute(addExternalProofToCollection);

		const { action } = await import("~/routes/app.collections");
		await expect(action({ context: context(), request: externalProofRequest() } as never)).rejects.toBe(failure);
	});
});
