export interface ShareBrandIdentityValue {
	brandName: string | null;
	brandWebsite: string | null;
	brandLogo: string | null;
}

export function ShareBrandIdentity({ identity }: { identity: ShareBrandIdentityValue }) {
	const website = safeBrandWebsite(identity.brandWebsite);
	const logoAlt = identity.brandName ? `${identity.brandName} logo` : "Agency logo";

	return (
		<div className="f9-share-brand-identity">
			{identity.brandLogo ? (
				<span className="f9-share-brand-logo">
					<img alt={logoAlt} src={identity.brandLogo} />
				</span>
			) : null}
			<span className="f9-share-brand-copy">
				<small>Prepared by</small>
				{identity.brandName ? <strong>{identity.brandName}</strong> : null}
				{website ? <a href={website.href}>{website.label}</a> : null}
			</span>
		</div>
	);
}

function safeBrandWebsite(value: string | null) {
	if (!value) {
		return null;
	}

	try {
		const parsed = new URL(value);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return null;
		}
		return {
			href: parsed.toString(),
			label: parsed.hostname.replace(/^www\./i, ""),
		};
	} catch {
		return null;
	}
}
