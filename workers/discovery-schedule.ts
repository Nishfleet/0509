export const DISCOVERY_REFRESH_CRON = "0 4 * * 1";

const INSTANCE_ALREADY_EXISTS = "instance.already_exists";
const INSTANCE_NOT_FOUND = "instance.not_found";

function errorCode(err: unknown): string | undefined {
	if (typeof err === "object" && err !== null && "code" in err) {
		if (typeof err.code === "string") return err.code;
	}
	if (
		err instanceof Error &&
		(err.message === INSTANCE_ALREADY_EXISTS || err.message === INSTANCE_NOT_FOUND)
	) {
		return err.message;
	}
	return undefined;
}

type DiscoveryStarter = Pick<Env, "DB" | "DISCOVERY_WORKFLOW">;

export async function startDiscoveryRefresh(
	env: DiscoveryStarter,
	scheduledTime: number,
): Promise<{ workspaces: number; started: number }> {
	const workspaces = await env.DB.prepare("SELECT id FROM workspace ORDER BY created_at").all<{
		id: string;
	}>();
	const tick = new Date(scheduledTime).toISOString().slice(0, 10);
	let started = 0;
	for (const workspace of workspaces.results) {
		const id = `discovery-refresh-${workspace.id}-${tick}`;
		try {
			await env.DISCOVERY_WORKFLOW.get(id);
			continue;
		} catch (err) {
			if (errorCode(err) !== INSTANCE_NOT_FOUND) throw err;
		}
		try {
			await env.DISCOVERY_WORKFLOW.create({
				id,
				params: { mode: "refresh", workspaceId: workspace.id },
			});
			started += 1;
		} catch (err) {
			if (errorCode(err) !== INSTANCE_ALREADY_EXISTS) throw err;
		}
	}
	return { workspaces: workspaces.results.length, started };
}
