-- MIG-SOCIAL-015-REPLY-AUDIENCE-V1
-- W05 owns reply eligibility policy; W03 remains canonical content authority.
CREATE TABLE IF NOT EXISTS social_content_reply_policies (
  content_id TEXT NOT NULL PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('everyone','verified','following','mentioned','followingNetwork')),
  mentioned_user_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(mentioned_user_ids_json)
      AND json_type(mentioned_user_ids_json) = 'array'
      AND json_array_length(mentioned_user_ids_json) <= 20),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_social_content_reply_policies_owner
  ON social_content_reply_policies (owner_user_id, updated_at);
