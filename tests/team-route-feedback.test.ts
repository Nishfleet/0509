import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Props = { children?: ReactNode } & Record<string, unknown>;

const session = {
	user: { id: "owner-1", email: "owner@example.com", name: "Owner" },
	session: { id: "session-1", userId: "owner-1", expiresAt: "2026-07-17T00:00:00.000Z" },
};

function context() {
	return { cloudflare: { env: {} } };
}

function request(intent: string, fields: Record<string, string> = {}) {
	const formData = new FormData();
	formData.set("intent", intent);
	for (const [key, value] of Object.entries(fields)) formData.set(key, value);
	return new Request("https://0509.io/app/team", { method: "POST", body: formData });
}

function mockActionDeps(overrides: Record<string, unknown> = {}) {
	vi.doMock("~/lib/auth.server", () => ({ requireSession: vi.fn().mockResolvedValue(session) }));
	vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn((value) => value.cloudflare.env) }));
	vi.doMock("~/lib/env.server", () => ({ appOrigin: vi.fn(() => "https://0509.io") }));
	vi.doMock("~/lib/workspace.server", () => ({
		createWorkspaceInvite: vi.fn(),
		resendWorkspaceInvite: vi.fn(),
		revokeWorkspaceMember: vi.fn(),
		...overrides,
	}));
	vi.doMock("~/lib/delivery.server", () => ({ sendTeamInviteEmail: vi.fn().mockResolvedValue(true) }));
}

function component(tag: string) {
	return ({ children, ...props }: Props) => createElement(tag, props, children);
}

async function mockTeamPresentation(actionData: unknown) {
	const confirmButtonProps: Props[] = [];

	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		return {
			...actual,
			Form: component("form"),
			Link: ({ children, to, ...props }: Props & { to?: string }) =>
				createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
			useActionData: () => actionData,
			useLoaderData: () => ({
				isMember: false,
				ownerName: null,
				plan: "agency",
				seatLimit: 10,
				members: [
					{
						id: "member-1",
						email: "first@example.com",
						status: "invited",
						createdAt: "2026-07-15T00:00:00.000Z",
						acceptedAt: null,
						tokenExpiresAt: "2026-07-22T00:00:00.000Z",
					},
					{
						id: "member-2",
						email: "second@example.com",
						status: "invited",
						createdAt: "2026-07-15T00:00:00.000Z",
						acceptedAt: null,
						tokenExpiresAt: "2026-07-22T00:00:00.000Z",
					},
				],
			}),
			useNavigation: () => ({ state: "idle", formData: null }),
		};
	});
	vi.doMock("~/components/dashboard-page", () => ({
		DashboardPage: component("main"),
		DashboardPageHeader: ({ title, lead }: { title: string; lead?: string }) =>
			createElement("header", null, createElement("h1", null, title), lead),
	}));
	vi.doMock("~/components/dashboard-route-loading", () => ({
		DashboardRouteError: component("div"),
		DashboardRouteLoading: component("div"),
	}));
	vi.doMock("~/components/confirm-button", () => ({
		ConfirmSubmitButton: (props: Props) => {
			confirmButtonProps.push(props);
			return createElement("button", { type: "button" }, props.children);
		},
	}));
	vi.doMock("~/components/local-time", () => ({ LocalTime: ({ iso }: { iso: string }) => createElement("time", null, iso) }));
	vi.doMock("~/components/submit-button", () => ({ SubmitButton: component("button") }));

	return { confirmButtonProps };
}

beforeEach(() => vi.resetModules());
afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("team action result contract", () => {
	it("echoes intent for invite, and intent plus memberId for resend and revoke", async () => {
		const createWorkspaceInvite = vi.fn().mockResolvedValue({ ok: true, token: "invite-token" });
		const resendWorkspaceInvite = vi.fn().mockResolvedValue({
			ok: true,
			token: "fresh-token",
			inviteeEmail: "member@example.com",
		});
		const revokeWorkspaceMember = vi.fn().mockResolvedValue(undefined);
		mockActionDeps({ createWorkspaceInvite, resendWorkspaceInvite, revokeWorkspaceMember });
		const { action } = await import("~/routes/app.team");

		await expect(action({ context: context(), request: request("invite", { email: "Member@Example.com" }) } as never)).resolves.toMatchObject({
			ok: true,
			intent: "invite",
		});
		await expect(action({ context: context(), request: request("resend-invite", { memberId: "member-7" }) } as never)).resolves.toMatchObject({
			ok: true,
			intent: "resend-invite",
			memberId: "member-7",
		});
		await expect(action({ context: context(), request: request("revoke", { memberId: "member-7" }) } as never)).resolves.toEqual({
			ok: true,
			intent: "revoke",
			memberId: "member-7",
			message: "Seat revoked. Their access ends immediately.",
		});
		expect(createWorkspaceInvite).toHaveBeenCalledTimes(1);
		expect(resendWorkspaceInvite).toHaveBeenCalledWith(expect.anything(), {
			ownerUserId: "owner-1",
			memberRowId: "member-7",
		});
		expect(revokeWorkspaceMember).toHaveBeenCalledWith(expect.anything(), {
			ownerUserId: "owner-1",
			memberRowId: "member-7",
		});
	});

	it("preserves scoped failure results for invite and resend, and rethrows revoke failures", async () => {
		const inviteFailure = vi.fn().mockResolvedValue({ ok: false, reason: "That teammate is already invited." });
		const resendFailure = vi.fn().mockResolvedValue({ ok: false, reason: "Invite no longer exists." });
		const revokeFailure = new Error("member lookup failed");
		const revokeWorkspaceMember = vi.fn().mockRejectedValue(revokeFailure);
		mockActionDeps({
			createWorkspaceInvite: inviteFailure,
			resendWorkspaceInvite: resendFailure,
			revokeWorkspaceMember,
		});
		const { action } = await import("~/routes/app.team");

		await expect(action({ context: context(), request: request("invite", { email: "Member@Example.com" }) } as never)).resolves.toEqual({
			ok: false,
			intent: "invite",
			message: "That teammate is already invited.",
		});
		await expect(action({ context: context(), request: request("resend-invite", { memberId: "member-7" }) } as never)).resolves.toEqual({
			ok: false,
			intent: "resend-invite",
			memberId: "member-7",
			message: "Invite no longer exists.",
		});
		await expect(action({ context: context(), request: request("revoke", { memberId: "member-7" }) } as never)).rejects.toBe(revokeFailure);
	});
});

describe("team feedback placement", () => {
	it("renders invite feedback in the global slot above member rows", async () => {
		await mockTeamPresentation({
			ok: false,
			intent: "invite",
			message: "Invite could not be sent.",
		});
		const { default: TeamRoute } = await import("~/routes/app.team");
		const markup = renderToStaticMarkup(createElement(TeamRoute));

		expect(markup.match(/Invite could not be sent\./g)).toHaveLength(1);
		expect(markup.indexOf("Invite could not be sent.")).toBeLessThan(markup.indexOf("first@example.com"));
	});

	it("renders resend feedback only beside the matching member row", async () => {
		await mockTeamPresentation({
			ok: false,
			intent: "resend-invite",
			memberId: "member-2",
			message: "Invite could not be resent.",
		});
		const { default: TeamRoute } = await import("~/routes/app.team");
		const markup = renderToStaticMarkup(createElement(TeamRoute));

		expect(markup.match(/Invite could not be resent\./g)).toHaveLength(1);
		const feedbackIndex = markup.indexOf("Invite could not be resent.");
		expect(feedbackIndex).toBeGreaterThan(markup.indexOf("second@example.com"));
		expect(markup.slice(0, markup.indexOf("second@example.com"))).not.toContain("Invite could not be resent.");
	});

	it("renders revoke feedback only beside the matching member row", async () => {
		const { confirmButtonProps } = await mockTeamPresentation({
			ok: false,
			intent: "revoke",
			memberId: "member-2",
			message: "Seat could not be revoked.",
		});
		const { default: TeamRoute } = await import("~/routes/app.team");
		const markup = renderToStaticMarkup(createElement(TeamRoute));

		expect(markup.match(/Seat could not be revoked\./g)).toHaveLength(1);
		const feedbackIndex = markup.indexOf("Seat could not be revoked.");
		expect(feedbackIndex).toBeGreaterThan(markup.indexOf("second@example.com"));
		expect(markup.slice(0, markup.indexOf("second@example.com"))).not.toContain("Seat could not be revoked.");
		expect(confirmButtonProps).toEqual([
			expect.objectContaining({ intent: "revoke", match: { memberId: "member-1" } }),
			expect.objectContaining({ intent: "revoke", match: { memberId: "member-2" } }),
		]);
	});
});
