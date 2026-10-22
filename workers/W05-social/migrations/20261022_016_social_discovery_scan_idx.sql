-- Keep cold discovery aggregation scans ordered and covering by topic/content.
-- Only public content edges participate in discovery ranking.
CREATE INDEX IF NOT EXISTS ix_social_target_topics_content_topic_target
  ON social_target_topics (topic_id, target_id)
  WHERE target_type = 'content';
