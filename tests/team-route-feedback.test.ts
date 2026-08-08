// @vitest-environment happy-dom
import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
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

async function mockTeamPresentation(
	actionData: unknown | (() => unknown),
	options: {
		isMember?: boolean;
		members?: Array<Record<string, unknown>>;
		ownerName?: string | null;
		plan?: "free" | "scout" | "starter" | "agency";
	} = {},
) {
	const confirmButtonProps: Props[] = [];

	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		return {
			...actual,
			Form: component("form"),
			Link: ({ children, to, ...props }: Props & { to?: string }) =>
				createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
			useActionData: () => (typeof actionData === "function" ? actionData() : actionData),
			useLoaderData: () => ({
				isMember: options.isMember ?? false,
				ownerName: options.ownerName ?? null,
				plan: options.plan ?? "agency",
				seatLimit: 10,
			members: options.members ?? [
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

beforeEach(() => {
	vi.resetModules();
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
	document.body.replaceChildren();
});

describe("team action result contract", () => {
	it("echoes intent for invite, and intent plus memberId for resend and revoke", async () => {
		const createWorkspaceInvite = vi.fn().mockResolvedValue({ ok: true, token: "invite-token" });
		const resendWorkspaceInvite = vi.fn().mockResolvedValue({
			ok: true,
			token: "fresh-token",
			inviteeEmail: "member@example.com",
		});
		const revokeWorkspaceMember = vi.fn().mockResolvedValue({ ok: true });
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
	it.each(["free", "scout", "starter"] as const)(
		"keeps %s owners behind one quiet Agency upgrade action",
		async (plan) => {
			await mockTeamPresentation(null, { plan });
			const { default: TeamRoute } = await import("~/routes/app.team");
			const markup = renderToStaticMarkup(createElement(TeamRoute));

			expect(markup).toContain("f9-acct-lock");
			expect(markup).toContain("Invite your teammates");
			expect(markup).toContain('href="/app/billing?source=team#plans"');
			expect(markup.match(/f9-evidence-cta--rank1/g)).toHaveLength(1);
			expect(markup).not.toContain('name="email"');
		},
	);

	it("shows the invite instrument only to Agency owners with room", async () => {
		await mockTeamPresentation(null, { plan: "agency", members: [] });
		const { default: TeamRoute } = await import("~/routes/app.team");
		const markup = renderToStaticMarkup(createElement(TeamRoute));

		expect(markup).not.toContain("f9-acct-lock");
		expect(markup).toContain("1 of 10 seats in use");
		expect(markup).toContain('name="email"');
		expect(markup).toContain("Send invite");
		expect(markup).toContain("No teammates have been invited yet.");
	});

	it("withholds the invite instrument when every Agency seat is occupied", async () => {
		await mockTeamPresentation(null, {
			plan: "agency",
			members: Array.from({ length: 9 }, (_, index) => ({
				acceptedAt: "2026-07-01T12:00:00.000Z",
				createdAt: "2026-06-30T12:00:00.000Z",
				email: `member-${index}@example.invalid`,
				id: `member-${index}`,
				status: "active",
				tokenExpiresAt: null,
			})),
		});
		const { default: TeamRoute } = await import("~/routes/app.team");
		const markup = renderToStaticMarkup(createElement(TeamRoute));

		expect(markup).toContain("10 of 10 seats in use");
		expect(markup).toContain("All 10 seats are occupied");
		expect(markup).not.toContain('name="email"');
	});

	it("shows members their shared seat without owner actions", async () => {
		await mockTeamPresentation(null, {
			isMember: true,
			ownerName: "Asha",
			plan: "free",
			members: [],
		});
		const { default: TeamRoute } = await import("~/routes/app.team");
		const markup = renderToStaticMarkup(createElement(TeamRoute));

		expect(markup).toContain("A seat in Asha&#x27;s workspace");
		expect(markup).toContain("workspace owner manages seats and billing");
		expect(markup).not.toContain('name="email"');
		expect(markup).not.toContain("f9-acct-lock");
	});

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

	it("keeps a successful revoke visible when revalidation removes that member", async () => {
		await mockTeamPresentation(
			{
				ok: true,
				intent: "revoke",
				memberId: "member-2",
				message: "Seat revoked. Their access ends immediately.",
			},
			{
				members: [
					{
						id: "member-1",
						email: "first@example.com",
						status: "invited",
						createdAt: "2026-07-15T00:00:00.000Z",
						acceptedAt: null,
						tokenExpiresAt: "2026-07-22T00:00:00.000Z",
					},
				],
			},
		);
		const { default: TeamRoute } = await import("~/routes/app.team");
		const markup = renderToStaticMarkup(createElement(TeamRoute));

		expect(markup.match(/Seat revoked\. Their access ends immediately\./g)).toHaveLength(1);
		expect(markup.match(/role="status"/g)).toHaveLength(1);
		expect(markup).toContain('id="team-action-feedback"');
		expect(markup).toContain('tabindex="-1"');
	});

	it("keeps expired invites visible without counting them as occupied seats", async () => {
		await mockTeamPresentation(null, {
			members: [
				{
					id: "expired-member",
					email: "expired@example.com",
					status: "invited",
					createdAt: "2026-07-01T00:00:00.000Z",
					acceptedAt: null,
					tokenExpiresAt: "2000-01-01T00:00:00.000Z",
				},
				{
					id: "active-member",
					email: "active@example.com",
					status: "active",
					createdAt: "2026-07-01T00:00:00.000Z",
					acceptedAt: "2026-07-02T00:00:00.000Z",
					tokenExpiresAt: null,
				},
			],
		});
		const { default: TeamRoute } = await import("~/routes/app.team");
		const markup = renderToStaticMarkup(createElement(TeamRoute));

		expect(markup).toContain("2 of 10 seats in use");
		expect(markup).toContain("Invite expired");
		expect(markup).toContain('name="email"');
	});

	it("moves focus to the stable completion target after a removed-member revoke", async () => {
		await mockTeamPresentation(
			{
				ok: true,
				intent: "revoke",
				memberId: "member-2",
				message: "Seat revoked. Their access ends immediately.",
			},
			{
				members: [
					{
						id: "member-1",
						email: "first@example.com",
						status: "invited",
						createdAt: "2026-07-15T00:00:00.000Z",
						acceptedAt: null,
						tokenExpiresAt: "2026-07-22T00:00:00.000Z",
					},
				],
			},
		);
		const container = document.createElement("div");
		document.body.appendChild(container);

		try {
			const { default: TeamRoute } = await import("~/routes/app.team");
			const root = createRoot(container);
			await act(async () => {
				root.render(createElement(TeamRoute));
			});

			expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
			expect(document.activeElement?.id).toBe("team-action-feedback");
			await act(async () => {
				root.unmount();
			});
		} finally {
			container.remove();
		}
	});

	it("refocuses the stable completion target after consecutive removed-member revokes", async () => {
		let actionData = {
			ok: true,
			intent: "revoke",
			memberId: "member-2",
			message: "Seat revoked. Their access ends immediately.",
		};
		await mockTeamPresentation(
			() => actionData,
			{
				members: [
					{
						id: "member-1",
						email: "first@example.com",
						status: "invited",
						createdAt: "2026-07-15T00:00:00.000Z",
						acceptedAt: null,
						tokenExpiresAt: "2026-07-22T00:00:00.000Z",
					},
				],
			},
		);
		const container = document.createElement("div");
		const interruptionTarget = document.createElement("button");
		document.body.appendChild(container);
		document.body.appendChild(interruptionTarget);
		const { default: TeamRoute } = await import("~/routes/app.team");
		const root = createRoot(container);

		try {
			await act(async () => root.render(createElement(TeamRoute)));
			expect(document.activeElement?.id).toBe("team-action-feedback");

			interruptionTarget.focus();
			expect(document.activeElement).toBe(interruptionTarget);
			actionData = { ...actionData, memberId: "member-3" };
			await act(async () => root.render(createElement(TeamRoute)));

			expect(document.activeElement?.id).toBe("team-action-feedback");
		} finally {
			await act(async () => root.unmount());
			container.remove();
			interruptionTarget.remove();
		}
	});
});
