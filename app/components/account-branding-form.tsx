import { Form } from "react-router";

import { SubmitButton } from "~/components/submit-button";

export function AccountBrandingForm({
	brandLogo,
	brandLogoInvalid,
	brandName,
}: {
	brandLogo: string | null;
	brandLogoInvalid: boolean;
	brandName: string | null;
}) {
	return (
		<Form className="f9-auth-form" encType="multipart/form-data" method="post">
			<input name="intent" type="hidden" value="save-report-branding" />
			<label className="f9-field">
				<span>Brand name shown to clients</span>
				<input
					defaultValue={brandName ?? ""}
					maxLength={60}
					name="brandName"
					placeholder="Your agency name"
					type="text"
				/>
			</label>
			<label className="f9-field">
				<span>Agency logo</span>
				<input
					accept="image/png,image/jpeg,image/webp"
					aria-describedby="brand-logo-help"
					aria-invalid={brandLogoInvalid || undefined}
					name="brandLogo"
					type="file"
				/>
				<small id="brand-logo-help">
					Optional. Upload one static PNG, JPEG, or WebP logo up to 48 KB. Animated WebP and SVG
					files are not accepted.
				</small>
			</label>
			{brandLogo ? (
				<div className="f9-brand-logo-preview">
					<img alt={`${brandName || "Current agency"} logo`} src={brandLogo} />
					<label className="f9-checkbox-row">
						<input name="removeBrandLogo" type="checkbox" value="true" />
						<span>Remove current logo</span>
					</label>
				</div>
			) : null}
			<SubmitButton
				className="f9-wk-btn-quiet"
				intent="save-report-branding"
				pendingLabel="Saving…"
			>
				Save branding
			</SubmitButton>
			<p className="f9-wk-dim">
				Shared report links lead with your agency name and optional logo. Five to Nine stays as a
				small attribution in the footer. Leave the name empty to clear it; an empty file selection
				keeps the current logo.
			</p>
		</Form>
	);
}
