export interface LogoCandidates {
	ldOrganizationLogo: string | null;
	ogImage: string | null;
	appleTouchIcon: string | null;
	registrableDomain: string;
}

export function logoCandidateUrls(candidates: LogoCandidates): readonly string[] {
	const urls: string[] = [];
	if (candidates.ldOrganizationLogo !== null) urls.push(candidates.ldOrganizationLogo);
	if (candidates.ogImage !== null) urls.push(candidates.ogImage);
	if (candidates.appleTouchIcon !== null) urls.push(candidates.appleTouchIcon);
	urls.push(`https://icons.duckduckgo.com/ip3/${candidates.registrableDomain}.ico`);
	return urls;
}
