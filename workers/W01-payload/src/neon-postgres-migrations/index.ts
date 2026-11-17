import * as migration_20261107_202531_neon_d1_01_payload_baseline from './20261107_202531_neon_d1_01_payload_baseline';
import * as migration_20261117_000001_auth_001_registration_batch from './20261117_000001_auth_001_registration_batch';

export const migrations = [
  {
    up: migration_20261107_202531_neon_d1_01_payload_baseline.up,
    down: migration_20261107_202531_neon_d1_01_payload_baseline.down,
    name: '20261107_202531_neon_d1_01_payload_baseline'
  },
  {
    up: migration_20261117_000001_auth_001_registration_batch.up,
    down: migration_20261117_000001_auth_001_registration_batch.down,
    name: '20261117_000001_auth_001_registration_batch'
  },
];
