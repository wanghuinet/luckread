-- D1-01 / W01 AUTH-001 registration idempotency and consent persistence.
-- W02 remains the identity authority; this migration adds only W01's bounded
-- registration envelope and registration consent record tables.
BEGIN;

CREATE TABLE public.auth_registration_envelopes (
  id text PRIMARY KEY NOT NULL,
  idempotency_key text NOT NULL,
  active_key text,
  scope text NOT NULL,
  endpoint text NOT NULL,
  payload_hash text NOT NULL,
  state text NOT NULL,
  response_digest text,
  committed_response text,
  expires_at timestamptz NOT NULL,
  consent_record_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_registration_envelopes_idempotency_key_idx
  ON public.auth_registration_envelopes (idempotency_key);
CREATE UNIQUE INDEX auth_registration_envelopes_active_key_idx
  ON public.auth_registration_envelopes (active_key);
CREATE INDEX auth_registration_envelopes_scope_endpoint_idx
  ON public.auth_registration_envelopes (scope, endpoint);
CREATE INDEX auth_registration_envelopes_payload_hash_idx
  ON public.auth_registration_envelopes (payload_hash);
CREATE INDEX auth_registration_envelopes_state_idx
  ON public.auth_registration_envelopes (state);
CREATE INDEX auth_registration_envelopes_expires_at_idx
  ON public.auth_registration_envelopes (expires_at);
CREATE INDEX auth_registration_envelopes_consent_record_id_idx
  ON public.auth_registration_envelopes (consent_record_id);

CREATE TABLE public.consents (
  id text PRIMARY KEY NOT NULL,
  actor_subject_id text NOT NULL,
  owner_subject_id text NOT NULL,
  resource_id text NOT NULL,
  resource_type text NOT NULL,
  purpose text NOT NULL,
  state text NOT NULL,
  policy_version text NOT NULL,
  legal_basis text NOT NULL,
  withdrawn_at timestamptz,
  retention_class text NOT NULL,
  retention_until timestamptz NOT NULL,
  source_authority text NOT NULL,
  legal_hold_ref text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX consents_actor_subject_id_idx ON public.consents (actor_subject_id);
CREATE INDEX consents_owner_subject_id_idx ON public.consents (owner_subject_id);
CREATE INDEX consents_resource_id_idx ON public.consents (resource_id);
CREATE INDEX consents_resource_type_idx ON public.consents (resource_type);
CREATE INDEX consents_purpose_idx ON public.consents (purpose);
CREATE INDEX consents_state_idx ON public.consents (state);
CREATE INDEX consents_policy_version_idx ON public.consents (policy_version);
CREATE INDEX consents_legal_basis_idx ON public.consents (legal_basis);
CREATE INDEX consents_withdrawn_at_idx ON public.consents (withdrawn_at);
CREATE INDEX consents_retention_class_idx ON public.consents (retention_class);
CREATE INDEX consents_retention_until_idx ON public.consents (retention_until);
CREATE INDEX consents_source_authority_idx ON public.consents (source_authority);
CREATE INDEX consents_legal_hold_ref_idx ON public.consents (legal_hold_ref);

COMMIT;
