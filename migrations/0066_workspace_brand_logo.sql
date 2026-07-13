-- Agency report branding: optional workspace logo for shared reports.
-- Stored as a size-capped data URL (PNG/JPEG/WebP base64 only, ~64KB max;
-- normalized/validated in app/lib/data/workspace-branding.server.ts — SVG is
-- rejected as a stored-XSS vector). Data URL over R2 on purpose: the image is
-- tiny, D1 keeps it next to the rest of the branding row, and no public R2
-- serving route is needed.
ALTER TABLE workspace_branding ADD COLUMN brand_logo TEXT;
