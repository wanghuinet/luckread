-- W03 / D1-02 stores the creator-selected media warning as content metadata.
-- The warning is limited to social posts with at least one attached media item.
ALTER TABLE contents
  ADD COLUMN media_warning TEXT
  CHECK (media_warning IS NULL OR media_warning IN ('NUDITY', 'VIOLENCE', 'SENSITIVE'));

ALTER TABLE content_revisions
  ADD COLUMN media_warning TEXT
  CHECK (media_warning IS NULL OR media_warning IN ('NUDITY', 'VIOLENCE', 'SENSITIVE'));
