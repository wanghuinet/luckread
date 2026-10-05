-- MIG-CONTENT-003-CREATOR-LIST-INDEX-V1
-- Logical authority: D1-02 / W03
-- Cost guard: cover creator-scoped cursor pagination without changing authority.
CREATE INDEX IF NOT EXISTS contents_owner_updated_at_id_idx
  ON contents(owner_user_id, updated_at, id);
