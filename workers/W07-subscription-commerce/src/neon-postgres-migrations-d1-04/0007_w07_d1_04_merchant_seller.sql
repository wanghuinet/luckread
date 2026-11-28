-- NEON_D1_04_W07_MERCHANT_SELLER_SCHEMA_V1
-- Target: luckread_finance (D1-04), PostgreSQL 18; logical owner W07.
-- Contract source: docs/116-MERCHANT-SELLER-PLATFORM-CONTRACT-v1.0.md and
-- docs/118-MERCHANT-SELLER-DATA-CONTRACT-v1.0.md.
-- Additive only. No cross-domain foreign keys, user/identity copies, ledger, tax,
-- payment routing, seller-of-record resolver, business data or runtime bindings.
-- Schema-only candidate. Remote Neon apply and production cutover are not authorized.

CREATE TABLE merchant_profiles (
  merchant_id TEXT PRIMARY KEY NOT NULL
    CHECK (char_length(merchant_id)=30 AND merchant_id ~ '^mrc_[A-Za-z0-9]{26}$'),
  merchant_type TEXT NOT NULL
    CHECK (merchant_type IN ('INDIVIDUAL','BUSINESS','BRAND','ORGANIZATION','SERVICE_PROVIDER')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACTIVE','RESTRICTED','SUSPENDED','CLOSED')),
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  identity_ref TEXT NOT NULL CHECK (char_length(identity_ref) BETWEEN 1 AND 512),
  verification_ref TEXT CHECK (verification_ref IS NULL OR char_length(verification_ref) BETWEEN 1 AND 512),
  primary_store_id TEXT
    CHECK (primary_store_id IS NULL OR (char_length(primary_store_id)=30 AND primary_store_id ~ '^str_[A-Za-z0-9]{26}$')),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL CHECK (updated_at>=created_at)
);

CREATE TABLE merchant_stores (
  store_id TEXT PRIMARY KEY NOT NULL
    CHECK (char_length(store_id)=30 AND store_id ~ '^str_[A-Za-z0-9]{26}$'),
  merchant_id TEXT NOT NULL
    CHECK (char_length(merchant_id)=30 AND merchant_id ~ '^mrc_[A-Za-z0-9]{26}$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PAUSED','CLOSED')),
  profile_ref TEXT CHECK (profile_ref IS NULL OR char_length(profile_ref) BETWEEN 1 AND 512),
  locale TEXT CHECK (locale IS NULL OR locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  region TEXT CHECK (region IS NULL OR char_length(region) BETWEEN 1 AND 64),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL CHECK (updated_at>=created_at)
);

CREATE TABLE merchant_qualifications (
  qualification_id TEXT PRIMARY KEY NOT NULL
    CHECK (char_length(qualification_id)=30 AND qualification_id ~ '^mql_[A-Za-z0-9]{26}$'),
  merchant_id TEXT NOT NULL
    CHECK (char_length(merchant_id)=30 AND merchant_id ~ '^mrc_[A-Za-z0-9]{26}$'),
  capability TEXT NOT NULL
    CHECK (capability IN ('DIGITAL_GOODS','PHYSICAL_GOODS','SUBSCRIPTION','CREATOR_AFFILIATE','LIVE_COMMERCE')),
  jurisdiction_country CHAR(2) NOT NULL CHECK (jurisdiction_country ~ '^[A-Z]{2}$'),
  jurisdiction_region TEXT CHECK (jurisdiction_region IS NULL OR char_length(jurisdiction_region) BETWEEN 1 AND 64),
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (status IN ('PENDING_REVIEW','APPROVED','DENIED','EXPIRED','RE_REVIEW')),
  evidence_ref TEXT CHECK (evidence_ref IS NULL OR char_length(evidence_ref) BETWEEN 1 AND 512),
  expires_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL CHECK (updated_at>=created_at),
  CHECK (expires_at IS NULL OR expires_at>created_at)
);

CREATE TABLE merchant_staff (
  staff_id TEXT PRIMARY KEY NOT NULL
    CHECK (char_length(staff_id)=30 AND staff_id ~ '^mst_[A-Za-z0-9]{26}$'),
  merchant_id TEXT NOT NULL
    CHECK (char_length(merchant_id)=30 AND merchant_id ~ '^mrc_[A-Za-z0-9]{26}$'),
  user_id TEXT NOT NULL CHECK (char_length(user_id) BETWEEN 1 AND 256),
  role TEXT NOT NULL
    CHECK (role IN ('OWNER','ADMIN','OPERATOR','FINANCE','CUSTOMER_SERVICE','ANALYST')),
  status TEXT NOT NULL DEFAULT 'INVITED'
    CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','REMOVED')),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL CHECK (updated_at>=created_at)
);

CREATE TABLE merchant_scopes (
  scope_id TEXT PRIMARY KEY NOT NULL
    CHECK (char_length(scope_id)=30 AND scope_id ~ '^msc_[A-Za-z0-9]{26}$'),
  merchant_id TEXT NOT NULL
    CHECK (char_length(merchant_id)=30 AND merchant_id ~ '^mrc_[A-Za-z0-9]{26}$'),
  staff_id TEXT NOT NULL
    CHECK (char_length(staff_id)=30 AND staff_id ~ '^mst_[A-Za-z0-9]{26}$'),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('STORE','PRODUCT','ORDER','SETTLEMENT_VIEW')),
  resource_id TEXT NOT NULL CHECK (char_length(resource_id) BETWEEN 1 AND 256),
  access_level TEXT NOT NULL CHECK (access_level IN ('READ','WRITE','MANAGE')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL CHECK (updated_at>=created_at),
  CHECK (scope_type<>'SETTLEMENT_VIEW' OR access_level='READ')
);

CREATE INDEX ix_merchant_profiles_status_created
  ON merchant_profiles(status,created_at,merchant_id);
CREATE INDEX ix_merchant_stores_merchant_status_created
  ON merchant_stores(merchant_id,status,created_at,store_id);
CREATE UNIQUE INDEX ux_merchant_qualifications_jurisdiction
  ON merchant_qualifications(merchant_id,capability,jurisdiction_country,COALESCE(jurisdiction_region,''));
CREATE INDEX ix_merchant_qualifications_status_expiry
  ON merchant_qualifications(status,expires_at,merchant_id);
CREATE UNIQUE INDEX ux_merchant_staff_active_user
  ON merchant_staff(merchant_id,user_id) WHERE status='ACTIVE';
CREATE UNIQUE INDEX ux_merchant_staff_active_owner
  ON merchant_staff(merchant_id) WHERE role='OWNER' AND status='ACTIVE';
CREATE UNIQUE INDEX ux_merchant_scopes_active_resource
  ON merchant_scopes(merchant_id,staff_id,scope_type,resource_id) WHERE status='ACTIVE';
CREATE INDEX ix_merchant_scopes_staff_status
  ON merchant_scopes(staff_id,status,scope_type,resource_id);

CREATE FUNCTION w07_d104_merchant_seller_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  CASE TG_ARGV[0]
    WHEN 'merchant_primary_store_guard' THEN
      IF NEW.primary_store_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.merchant_stores s
        WHERE s.store_id=NEW.primary_store_id AND s.merchant_id=NEW.merchant_id
      ) THEN
        RAISE EXCEPTION 'primary store must belong to the same merchant' USING ERRCODE='23514';
      END IF;
    WHEN 'merchant_identity_immutable' THEN
      IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
        OR NEW.merchant_type IS DISTINCT FROM OLD.merchant_type
        OR NEW.identity_ref IS DISTINCT FROM OLD.identity_ref
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'merchant identity is immutable' USING ERRCODE='23514';
      END IF;
    WHEN 'merchant_version_guard' THEN
      IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
        RAISE EXCEPTION 'merchant update requires one-step version CAS and increasing updated_at' USING ERRCODE='23514';
      END IF;
    WHEN 'merchant_transition_guard' THEN
      IF NOT (
        (OLD.status='PENDING' AND NEW.status IN ('PENDING','ACTIVE','RESTRICTED','SUSPENDED','CLOSED'))
        OR (OLD.status='ACTIVE' AND NEW.status IN ('ACTIVE','RESTRICTED','SUSPENDED','CLOSED'))
        OR (OLD.status='RESTRICTED' AND NEW.status IN ('RESTRICTED','ACTIVE','SUSPENDED','CLOSED'))
        OR (OLD.status='SUSPENDED' AND NEW.status IN ('SUSPENDED','ACTIVE','RESTRICTED','CLOSED'))
        OR (OLD.status='CLOSED' AND NEW.status='CLOSED')
      ) THEN RAISE EXCEPTION 'forbidden merchant status transition' USING ERRCODE='23514'; END IF;
    WHEN 'merchant_retained' THEN
      RAISE EXCEPTION 'merchant records are retained' USING ERRCODE='23514';

    WHEN 'store_requires_merchant' THEN
      IF NOT EXISTS (SELECT 1 FROM public.merchant_profiles m
        WHERE m.merchant_id=NEW.merchant_id AND m.status<>'CLOSED') THEN
        RAISE EXCEPTION 'store requires an existing non-closed merchant' USING ERRCODE='23514';
      END IF;
    WHEN 'store_identity_immutable' THEN
      IF NEW.store_id IS DISTINCT FROM OLD.store_id
        OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'store identity and ownership are immutable' USING ERRCODE='23514';
      END IF;
    WHEN 'store_version_guard' THEN
      IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
        RAISE EXCEPTION 'store update requires one-step version CAS and increasing updated_at' USING ERRCODE='23514';
      END IF;
    WHEN 'store_transition_guard' THEN
      IF NOT ((OLD.status='OPEN' AND NEW.status IN ('OPEN','PAUSED','CLOSED'))
        OR (OLD.status='PAUSED' AND NEW.status IN ('PAUSED','OPEN','CLOSED'))
        OR (OLD.status='CLOSED' AND NEW.status='CLOSED')) THEN
        RAISE EXCEPTION 'forbidden store status transition' USING ERRCODE='23514';
      END IF;
    WHEN 'store_retained' THEN
      RAISE EXCEPTION 'store records are retained' USING ERRCODE='23514';

    WHEN 'qualification_requires_merchant' THEN
      IF NOT EXISTS (SELECT 1 FROM public.merchant_profiles m
        WHERE m.merchant_id=NEW.merchant_id AND m.status<>'CLOSED') THEN
        RAISE EXCEPTION 'qualification requires an existing non-closed merchant' USING ERRCODE='23514';
      END IF;
    WHEN 'qualification_identity_immutable' THEN
      IF NEW.qualification_id IS DISTINCT FROM OLD.qualification_id
        OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
        OR NEW.capability IS DISTINCT FROM OLD.capability
        OR NEW.jurisdiction_country IS DISTINCT FROM OLD.jurisdiction_country
        OR NEW.jurisdiction_region IS DISTINCT FROM OLD.jurisdiction_region
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'qualification identity is immutable' USING ERRCODE='23514';
      END IF;
    WHEN 'qualification_version_guard' THEN
      IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
        RAISE EXCEPTION 'qualification update requires one-step version CAS and increasing updated_at' USING ERRCODE='23514';
      END IF;
    WHEN 'qualification_transition_guard' THEN
      IF NOT (
        (OLD.status='PENDING_REVIEW' AND NEW.status IN ('PENDING_REVIEW','APPROVED','DENIED','RE_REVIEW'))
        OR (OLD.status='APPROVED' AND NEW.status IN ('APPROVED','EXPIRED','RE_REVIEW'))
        OR (OLD.status='DENIED' AND NEW.status IN ('DENIED','RE_REVIEW'))
        OR (OLD.status='EXPIRED' AND NEW.status IN ('EXPIRED','RE_REVIEW'))
        OR (OLD.status='RE_REVIEW' AND NEW.status IN ('RE_REVIEW','APPROVED','DENIED'))
      ) THEN RAISE EXCEPTION 'forbidden qualification status transition' USING ERRCODE='23514'; END IF;
    WHEN 'qualification_retained' THEN
      RAISE EXCEPTION 'qualification records are retained' USING ERRCODE='23514';

    WHEN 'staff_requires_merchant' THEN
      IF NOT EXISTS (SELECT 1 FROM public.merchant_profiles m
        WHERE m.merchant_id=NEW.merchant_id AND m.status<>'CLOSED') THEN
        RAISE EXCEPTION 'staff membership requires an existing non-closed merchant' USING ERRCODE='23514';
      END IF;
    WHEN 'staff_identity_immutable' THEN
      IF NEW.staff_id IS DISTINCT FROM OLD.staff_id
        OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'staff identity is immutable' USING ERRCODE='23514';
      END IF;
    WHEN 'staff_version_guard' THEN
      IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
        RAISE EXCEPTION 'staff update requires one-step version CAS and increasing updated_at' USING ERRCODE='23514';
      END IF;
    WHEN 'staff_transition_guard' THEN
      IF NOT (
        (OLD.status='INVITED' AND NEW.status IN ('INVITED','ACTIVE','REMOVED'))
        OR (OLD.status='ACTIVE' AND NEW.status IN ('ACTIVE','SUSPENDED','REMOVED'))
        OR (OLD.status='SUSPENDED' AND NEW.status IN ('SUSPENDED','ACTIVE','REMOVED'))
        OR (OLD.status='REMOVED' AND NEW.status='REMOVED')
      ) THEN RAISE EXCEPTION 'forbidden staff status transition' USING ERRCODE='23514'; END IF;
    WHEN 'staff_retained' THEN
      RAISE EXCEPTION 'merchant staff records are retained' USING ERRCODE='23514';

    WHEN 'scope_requires_active_staff' THEN
      IF NOT EXISTS (SELECT 1 FROM public.merchant_staff s
        WHERE s.staff_id=NEW.staff_id AND s.merchant_id=NEW.merchant_id AND s.status='ACTIVE') THEN
        RAISE EXCEPTION 'scope requires active staff in the same merchant' USING ERRCODE='23514';
      END IF;
      IF NEW.scope_type='STORE' AND NOT EXISTS (
        SELECT 1 FROM public.merchant_stores s
        WHERE s.store_id=NEW.resource_id AND s.merchant_id=NEW.merchant_id AND s.status<>'CLOSED'
      ) THEN
        RAISE EXCEPTION 'store scope requires a store owned by the same merchant' USING ERRCODE='23514';
      END IF;
    WHEN 'scope_identity_immutable' THEN
      IF NEW.scope_id IS DISTINCT FROM OLD.scope_id
        OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
        OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
        OR NEW.scope_type IS DISTINCT FROM OLD.scope_type
        OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'merchant scope identity is immutable' USING ERRCODE='23514';
      END IF;
    WHEN 'scope_version_guard' THEN
      IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
        RAISE EXCEPTION 'scope update requires one-step version CAS and increasing updated_at' USING ERRCODE='23514';
      END IF;
    WHEN 'scope_transition_guard' THEN
      IF NOT ((OLD.status='ACTIVE' AND NEW.status IN ('ACTIVE','REVOKED'))
        OR (OLD.status='REVOKED' AND NEW.status='REVOKED')) THEN
        RAISE EXCEPTION 'revoked merchant scope is terminal' USING ERRCODE='23514';
      END IF;
    WHEN 'scope_retained' THEN
      RAISE EXCEPTION 'merchant scope grants are retained' USING ERRCODE='23514';
    ELSE
      RAISE EXCEPTION 'unknown W07 merchant/seller guard action %',TG_ARGV[0] USING ERRCODE='55000';
  END CASE;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER merchant_primary_store_guard
BEFORE INSERT OR UPDATE OF primary_store_id ON merchant_profiles
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('merchant_primary_store_guard');
CREATE TRIGGER merchant_identity_immutable
BEFORE UPDATE ON merchant_profiles
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('merchant_identity_immutable');
CREATE TRIGGER merchant_version_guard
BEFORE UPDATE ON merchant_profiles
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('merchant_version_guard');
CREATE TRIGGER merchant_transition_guard
BEFORE UPDATE OF status ON merchant_profiles
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('merchant_transition_guard');
CREATE TRIGGER merchant_retained
BEFORE DELETE ON merchant_profiles
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('merchant_retained');

CREATE TRIGGER store_requires_merchant
BEFORE INSERT ON merchant_stores
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('store_requires_merchant');
CREATE TRIGGER store_identity_immutable
BEFORE UPDATE ON merchant_stores
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('store_identity_immutable');
CREATE TRIGGER store_version_guard
BEFORE UPDATE ON merchant_stores
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('store_version_guard');
CREATE TRIGGER store_transition_guard
BEFORE UPDATE OF status ON merchant_stores
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('store_transition_guard');
CREATE TRIGGER store_retained
BEFORE DELETE ON merchant_stores
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('store_retained');

CREATE TRIGGER qualification_requires_merchant
BEFORE INSERT ON merchant_qualifications
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('qualification_requires_merchant');
CREATE TRIGGER qualification_identity_immutable
BEFORE UPDATE ON merchant_qualifications
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('qualification_identity_immutable');
CREATE TRIGGER qualification_version_guard
BEFORE UPDATE ON merchant_qualifications
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('qualification_version_guard');
CREATE TRIGGER qualification_transition_guard
BEFORE UPDATE OF status ON merchant_qualifications
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('qualification_transition_guard');
CREATE TRIGGER qualification_retained
BEFORE DELETE ON merchant_qualifications
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('qualification_retained');

CREATE TRIGGER staff_requires_merchant
BEFORE INSERT ON merchant_staff
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('staff_requires_merchant');
CREATE TRIGGER staff_identity_immutable
BEFORE UPDATE ON merchant_staff
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('staff_identity_immutable');
CREATE TRIGGER staff_version_guard
BEFORE UPDATE ON merchant_staff
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('staff_version_guard');
CREATE TRIGGER staff_transition_guard
BEFORE UPDATE OF status ON merchant_staff
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('staff_transition_guard');
CREATE TRIGGER staff_retained
BEFORE DELETE ON merchant_staff
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('staff_retained');

CREATE TRIGGER scope_requires_active_staff
BEFORE INSERT ON merchant_scopes
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('scope_requires_active_staff');
CREATE TRIGGER scope_identity_immutable
BEFORE UPDATE ON merchant_scopes
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('scope_identity_immutable');
CREATE TRIGGER scope_version_guard
BEFORE UPDATE ON merchant_scopes
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('scope_version_guard');
CREATE TRIGGER scope_transition_guard
BEFORE UPDATE OF status ON merchant_scopes
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('scope_transition_guard');
CREATE TRIGGER scope_retained
BEFORE DELETE ON merchant_scopes
FOR EACH ROW EXECUTE FUNCTION w07_d104_merchant_seller_guard('scope_retained');

COMMENT ON TABLE merchant_profiles IS 'W07 authoritative merchant identity/lifecycle record; legal identity is referenced, never copied.';
COMMENT ON TABLE merchant_stores IS 'W07 merchant-owned store records; ownership is immutable and enforced without cross-domain foreign keys.';
COMMENT ON TABLE merchant_qualifications IS 'W07 seller capability qualification by jurisdiction; evidence is stored by reference only.';
COMMENT ON TABLE merchant_staff IS 'W07 merchant staff membership; user identity remains owned by W02.';
COMMENT ON TABLE merchant_scopes IS 'W07 explicit deny-by-default staff resource scopes; settlement scope is read-only.';
