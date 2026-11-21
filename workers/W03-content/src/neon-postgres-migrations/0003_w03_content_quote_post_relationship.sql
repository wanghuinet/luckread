-- GENERATED FILE. Do not hand-edit.
-- Migration: d1-02-w03-content-quote-post-relationship-v1
-- Owner: W03. Forward-only constraint expansion; preserves all existing relationship rows.
-- Adds the quote-post relation type without rewriting the already-applied v1 schema artifact.

BEGIN;

ALTER TABLE public.content_relationships
  DROP CONSTRAINT content_relationships_relation_type_check;

ALTER TABLE public.content_relationships
  ADD CONSTRAINT content_relationships_relation_type_check
  CHECK (relation_type IN ('reference', 'quote-post', 'series-member', 'collection-member', 'thread-next'))
  NOT VALID;

ALTER TABLE public.content_relationships
  VALIDATE CONSTRAINT content_relationships_relation_type_check;

ALTER TABLE public.content_relationships
  DROP CONSTRAINT content_relationships_check;

ALTER TABLE public.content_relationships
  ADD CONSTRAINT content_relationships_check
  CHECK (
    (relation_type IN ('reference', 'quote-post') AND target_type = 'content' AND position IS NULL)
    OR (relation_type = 'series-member' AND target_type = 'series' AND position IS NOT NULL AND position >= 0)
    OR (relation_type = 'collection-member' AND target_type = 'collection' AND position IS NOT NULL AND position >= 0)
    OR (relation_type = 'thread-next' AND target_type = 'content' AND position IS NULL)
  )
  NOT VALID;

ALTER TABLE public.content_relationships
  VALIDATE CONSTRAINT content_relationships_check;

COMMIT;
