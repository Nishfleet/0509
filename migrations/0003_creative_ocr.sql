ALTER TABLE ad ADD COLUMN creative_text TEXT;
ALTER TABLE ad ADD COLUMN creative_text_capture_method TEXT CHECK (
  creative_text_capture_method IN ('ad_snapshot_fetch', 'browser_render', 'manual')
);
ALTER TABLE ad ADD COLUMN creative_text_metadata_json TEXT;

UPDATE ad
SET
  creative_text = COALESCE(creative_text, json_extract(raw_json, '$.creativeText')),
  creative_text_capture_method = COALESCE(
    creative_text_capture_method,
    json_extract(raw_json, '$.creativeTextCaptureMethod')
  ),
  creative_text_metadata_json = COALESCE(
    creative_text_metadata_json,
    json_extract(raw_json, '$.creativeTextMetadata')
  )
WHERE
  creative_text IS NULL
  OR creative_text_capture_method IS NULL
  OR creative_text_metadata_json IS NULL;
