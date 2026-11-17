import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "auth_registration_envelopes" (
      "id" text PRIMARY KEY NOT NULL,
      "idempotency_key" text NOT NULL,
      "active_key" text,
      "scope" text NOT NULL,
      "endpoint" text NOT NULL,
      "payload_hash" text NOT NULL,
      "state" text NOT NULL,
      "response_digest" text,
      "committed_response" text,
      "expires_at" timestamptz NOT NULL,
      "consent_record_id" text,
      "updated_at" timestamptz DEFAULT now() NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL
    );

    CREATE INDEX "auth_registration_envelopes_idempotency_key_idx"
      ON "auth_registration_envelopes" USING btree ("idempotency_key");
    CREATE UNIQUE INDEX "auth_registration_envelopes_active_key_idx"
      ON "auth_registration_envelopes" USING btree ("active_key");
    CREATE INDEX "auth_registration_envelopes_scope_endpoint_idx"
      ON "auth_registration_envelopes" USING btree ("scope", "endpoint");
    CREATE INDEX "auth_registration_envelopes_payload_hash_idx"
      ON "auth_registration_envelopes" USING btree ("payload_hash");
    CREATE INDEX "auth_registration_envelopes_state_idx"
      ON "auth_registration_envelopes" USING btree ("state");
    CREATE INDEX "auth_registration_envelopes_expires_at_idx"
      ON "auth_registration_envelopes" USING btree ("expires_at");
    CREATE INDEX "auth_registration_envelopes_consent_record_id_idx"
      ON "auth_registration_envelopes" USING btree ("consent_record_id");

    CREATE TABLE "consents" (
      "id" text PRIMARY KEY NOT NULL,
      "actor_subject_id" text NOT NULL,
      "owner_subject_id" text NOT NULL,
      "resource_id" text NOT NULL,
      "resource_type" text NOT NULL,
      "purpose" text NOT NULL,
      "state" text NOT NULL,
      "policy_version" text NOT NULL,
      "legal_basis" text NOT NULL,
      "withdrawn_at" timestamptz,
      "retention_class" text NOT NULL,
      "retention_until" timestamptz NOT NULL,
      "source_authority" text NOT NULL,
      "legal_hold_ref" text,
      "updated_at" timestamptz DEFAULT now() NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL
    );

    CREATE INDEX "consents_actor_subject_id_idx" ON "consents" USING btree ("actor_subject_id");
    CREATE INDEX "consents_owner_subject_id_idx" ON "consents" USING btree ("owner_subject_id");
    CREATE INDEX "consents_resource_id_idx" ON "consents" USING btree ("resource_id");
    CREATE INDEX "consents_resource_type_idx" ON "consents" USING btree ("resource_type");
    CREATE INDEX "consents_purpose_idx" ON "consents" USING btree ("purpose");
    CREATE INDEX "consents_state_idx" ON "consents" USING btree ("state");
    CREATE INDEX "consents_policy_version_idx" ON "consents" USING btree ("policy_version");
    CREATE INDEX "consents_legal_basis_idx" ON "consents" USING btree ("legal_basis");
    CREATE INDEX "consents_withdrawn_at_idx" ON "consents" USING btree ("withdrawn_at");
    CREATE INDEX "consents_retention_class_idx" ON "consents" USING btree ("retention_class");
    CREATE INDEX "consents_retention_until_idx" ON "consents" USING btree ("retention_until");
    CREATE INDEX "consents_source_authority_idx" ON "consents" USING btree ("source_authority");
    CREATE INDEX "consents_legal_hold_ref_idx" ON "consents" USING btree ("legal_hold_ref");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM public.auth_registration_envelopes LIMIT 1)
        OR EXISTS (SELECT 1 FROM public.consents LIMIT 1)
      THEN
        RAISE EXCEPTION 'W01_AUTH001_REGISTRATION_ROLLBACK_REFUSED: registration or consent rows exist';
      END IF;
    END
    $$;

    DROP TABLE "auth_registration_envelopes";
    DROP TABLE "consents";
  `)
}
