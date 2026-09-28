export interface LogoCandidates {
	ldOrganizationLogo: string | null;
	ogImage: string | null;
	appleTouchIcon: string | null;
	registrableDomain: string;
}

export type LogoResult =
	| {
			ok: true;
			url: string;
			source:
				| "ld_organization"
				| "og_image"
				| "apple_touch_icon"
				| "duckduckgo";
	  }
	| { ok: false; reason: "no_logo" };

type LogoSource = Extract<LogoResult, { ok: true }>["source"];

export async function resolveLogo(
	candidates: LogoCandidates,
): Promise<LogoResult> {
	const ordered: [LogoSource, string | null][] = [
		["ld_organization", candidates.ldOrganizationLogo],
		["og_image", candidates.ogImage],
		["apple_touch_icon", candidates.appleTouchIcon],
		[
			"duckduckgo",
			`https://icons.duckduckgo.com/ip3/${candidates.registrableDomain}.ico`,
		],
	];

	for (const [source, url] of ordered) {
		if (url === null) continue;
		try {
			const res = await fetch(url, {
				method: "GET",
				signal: AbortSignal.timeout(8000),
			});
			await res.body?.cancel();
			if (res.ok) return { ok: true, url, source };
		} catch (error) {
			console.error(JSON.stringify({ event: "identity.logo_probe_failed", error: String(error) }));
			continue;
		}
	}

	return { ok: false, reason: "no_logo" };
}
