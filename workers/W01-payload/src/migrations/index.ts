import * as migration_20250929_111647 from './20250929_111647'
import * as migration_20260921_003203_MIG_AUTH_002_SESSION_V1 from './20260921_003203_MIG_AUTH_002_SESSION_V1'

export const migrations = [
  {
    up: migration_20250929_111647.up,
    down: migration_20250929_111647.down,
    name: '20250929_111647',
  },
  {
    up: migration_20260921_003203_MIG_AUTH_002_SESSION_V1.up,
    down: migration_20260921_003203_MIG_AUTH_002_SESSION_V1.down,
    name: '20260921_003203_MIG_AUTH_002_SESSION_V1',
  },
]
