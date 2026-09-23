export async function idHash(...parts: string[]): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(parts.join(":")),
	);
	return [...new Uint8Array(digest)]
		.slice(0, 12)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export async function discoveryEntityId(workspaceId: string, domain: string): Promise<string> {
	return `ent_${await idHash(workspaceId, domain)}`;
}
