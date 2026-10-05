import { createAdapterFactory } from 'better-auth/adapters'
import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'

const PAYLOAD_HASH_PREFIX = 'pbkdf2-sha256-v1:'
const PACKED_PASSWORD_PREFIX = 'luckread-payload-pbkdf2-v1:'
const PBKDF2_ITERATIONS = 600000
const PBKDF2_KEY_LENGTH = 32
const LEGACY_PBKDF2_ITERATIONS = 25000
const LEGACY_PBKDF2_KEY_LENGTH = 512

type Row = Record<string, unknown>
type WhereClause = { field: string; value: unknown; operator?: string; connector?: string; mode?: string }

const USER_FIELDS: Record<string, string> = {
  id: 'id', email: 'email', username: 'username', display_name: 'display_name',
  bio: 'bio', avatar: 'avatar', locale: 'locale', timezone: 'timezone',
  account_state: 'account_state', account_state_version: 'account_state_version',
  created_at: 'created_at', updated_at: 'updated_at',
}
const SESSION_FIELDS: Record<string, string> = {
  id: 'id', _parent_id: '_parent_id', created_at: 'created_at', expires_at: 'expires_at',
}
const AUTHENTICATABLE_STATES = new Set(['PENDING_VERIFICATION', 'ACTIVE'])

const iso = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  return new Date().toISOString()
}

const packPassword = (salt: string, hash: string): string =>
  PACKED_PASSWORD_PREFIX + salt + ':' + hash

const unpackPassword = (value: string): { salt: string; hash: string } | null => {
  if (!value.startsWith(PACKED_PASSWORD_PREFIX)) return null
  const packed = value.slice(PACKED_PASSWORD_PREFIX.length)
  const separator = packed.indexOf(':')
  if (separator <= 0) return null
  const salt = packed.slice(0, separator)
  const hash = packed.slice(separator + 1)
  return /^[0-9a-f]{64}$/i.test(salt) &&
    (/^pbkdf2-sha256-v1:[0-9a-f]{64}$/i.test(hash) || /^[0-9a-f]{1024}$/i.test(hash))
    ? { salt, hash }
    : null
}

const derive = (
  password: string,
  salt: string,
  iterations = PBKDF2_ITERATIONS,
  keyLength = PBKDF2_KEY_LENGTH,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, keyLength, 'sha256', (error, key) =>
      error ? reject(error) : resolve(key),
    )
  })

export const hashLuckReadPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(32).toString('hex')
  const key = await derive(password, salt)
  return packPassword(salt, PAYLOAD_HASH_PREFIX + key.toString('hex'))
}

export const verifyLuckReadPassword = async ({
  password,
  hash,
}: {
  password: string
  hash: string
}): Promise<boolean> => {
  const packed = unpackPassword(hash)
  if (!packed) return false
  const isCurrent = packed.hash.startsWith(PAYLOAD_HASH_PREFIX)
  const expectedHex = isCurrent ? packed.hash.slice(PAYLOAD_HASH_PREFIX.length) : packed.hash
  if (!/^[0-9a-f]+$/i.test(expectedHex) || expectedHex.length % 2 !== 0) return false
  const expected = Buffer.from(expectedHex, 'hex')
  const actual = await derive(
    password,
    packed.salt,
    isCurrent ? PBKDF2_ITERATIONS : LEGACY_PBKDF2_ITERATIONS,
    isCurrent ? PBKDF2_KEY_LENGTH : LEGACY_PBKDF2_KEY_LENGTH,
  )
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

const normalizeUser = (row: Row): Row => {
  const accountState = typeof row.account_state === 'string' ? row.account_state : 'PENDING_VERIFICATION'
  const username = typeof row.username === 'string' ? row.username : ''
  const email = String(row.email ?? '')
  return {
    ...row,
    name: typeof row.display_name === 'string' && row.display_name ? row.display_name : username || email,
    image: typeof row.avatar === 'string' ? row.avatar : null,
    emailVerified: accountState !== 'PENDING_VERIFICATION',
  }
}

const whereValue = (where: WhereClause[], ...fields: string[]): unknown => {
  const found = where.find((clause) => fields.includes(clause.field) && (clause.operator ?? 'eq') === 'eq')
  return found?.value
}

const userIdFromWhere = (where: WhereClause[]): string | null => {
  const value = whereValue(where, 'id')
  return value === undefined || value === null ? null : String(value)
}

const userIdFromAccountWhere = (where: WhereClause[]): string | null => {
  const direct = whereValue(where, 'user_id', 'userId')
  if (direct !== undefined && direct !== null) return String(direct)
  const account = whereValue(where, 'account_id', 'accountId', 'id')
  if (account === undefined || account === null) return null
  const value = String(account)
  return value.startsWith('credential:') ? value.slice('credential:'.length) : value
}

const sqlField = (model: 'users' | 'users_sessions', field: string): string | null =>
  (model === 'users' ? USER_FIELDS : SESSION_FIELDS)[field] ?? null

const buildWhere = (
  model: 'users' | 'users_sessions',
  where: WhereClause[] | undefined,
  params: unknown[],
): string => {
  if (!where?.length) return ''
  const parts: string[] = []

  for (const clause of where) {
    const field = sqlField(model, clause.field)
    if (!field) throw new Error('Unsupported Better Auth query field: ' + clause.field)
    const operator = clause.operator ?? 'eq'
    const value = clause.value
    const insensitive = clause.mode === 'insensitive'

    if ((operator === 'in' || operator === 'not_in') && Array.isArray(value)) {
      if (value.length === 0) {
        parts.push(operator === 'in' ? '1 = 0' : '1 = 1')
      } else {
        parts.push(field + (operator === 'in' ? ' IN (' : ' NOT IN (') + value.map(() => '?').join(', ') + ')')
        params.push(...value)
      }
      continue
    }

    if (value === null || value === undefined) {
      parts.push(field + (operator === 'ne' ? ' IS NOT NULL' : ' IS NULL'))
      continue
    }

    const normalizedField = insensitive && typeof value === 'string' ? 'LOWER(' + field + ')' : field
    switch (operator) {
      case 'ne':
        parts.push(normalizedField + (insensitive ? ' <> LOWER(?)' : ' <> ?'))
        params.push(value)
        break
      case 'gt':
        parts.push(field + ' > ?')
        params.push(value)
        break
      case 'gte':
        parts.push(field + ' >= ?')
        params.push(value)
        break
      case 'lt':
        parts.push(field + ' < ?')
        params.push(value)
        break
      case 'lte':
        parts.push(field + ' <= ?')
        params.push(value)
        break
      case 'contains':
        parts.push(normalizedField + ' LIKE ?')
        params.push((insensitive ? '%' + String(value).toLowerCase() : '%' + String(value)) + '%')
        break
      case 'starts_with':
        parts.push(normalizedField + ' LIKE ?')
        params.push((insensitive ? String(value).toLowerCase() : String(value)) + '%')
        break
      case 'ends_with':
        parts.push(normalizedField + ' LIKE ?')
        params.push('%' + (insensitive ? String(value).toLowerCase() : String(value)))
        break
      default:
        parts.push(normalizedField + (insensitive ? ' = LOWER(?)' : ' = ?'))
        params.push(value)
    }
  }

  return ' WHERE ' + parts
    .map((part, index) => (index === 0 ? part : ((where[index]?.connector ?? 'AND') + ' ' + part)))
    .join(' ')
}

const selectUserById = async (db: D1Database, id: string): Promise<Row | null> =>
  db.prepare('SELECT * FROM users WHERE CAST(id AS TEXT) = ? LIMIT 1').bind(id).first<Row>()

const selectUserByEmail = async (db: D1Database, email: string): Promise<Row | null> =>
  db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1').bind(email).first<Row>()

const selectSession = async (db: D1Database, id: string): Promise<Row | null> =>
  db.prepare(
    'SELECT s.id, s._parent_id, s.created_at, s.expires_at, s.created_at AS updatedAt, ' +
      'NULL AS ipAddress, NULL AS userAgent, u.account_state, u.email ' +
      'FROM users_sessions s INNER JOIN users u ON u.id = s._parent_id WHERE s.id = ? LIMIT 1',
  ).bind(id).first<Row>()

const buildCredentialAccount = (row: Row): Row | null => {
  if (!row.id || typeof row.hash !== 'string' || typeof row.salt !== 'string') return null
  if (!AUTHENTICATABLE_STATES.has(String(row.account_state))) return null
  return {
    id: 'credential:' + String(row.id),
    userId: String(row.id),
    accountId: String(row.id),
    providerId: 'credential',
    password: packPassword(String(row.salt), String(row.hash)),
    createdAt: new Date(iso(row.created_at)),
    updatedAt: new Date(iso(row.updated_at)),
    accountId: String(row.id),
    providerId: 'credential',
    userId: String(row.id),
  }
}

const adapter = (db: D1Database) =>
  createAdapterFactory({
    config: {
      adapterId: 'luckread-d1-01-bridge',
      adapterName: 'LuckRead D1-01 Better Auth Bridge',
      usePlural: false,
      supportsDates: true,
      supportsBooleans: true,
      supportsJSON: false,
      supportsArrays: false,
      supportsNumericIds: true,
      transaction: false,
    },
    adapter: () => ({
      create: async ({ model, data }) => {
        if (model === 'users') {
          const email = String(data.email ?? '').trim().toLowerCase()
          const username = typeof data.username === 'string' && data.username.trim()
            ? data.username.trim()
            : email.split('@')[0] + '-' + crypto.randomUUID().slice(0, 8)

          await db.prepare(
            'INSERT INTO users (email, username, display_name, bio, avatar, locale, timezone, account_state, account_state_version, salt, hash) ' +
              "VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_VERIFICATION', 1, NULL, NULL)",
          ).bind(
            email,
            username,
            typeof data.display_name === 'string' ? data.display_name : email,
            typeof data.bio === 'string' ? data.bio : null,
            typeof data.avatar === 'string' ? data.avatar : null,
            typeof data.locale === 'string' ? data.locale : 'en-US',
            typeof data.timezone === 'string' ? data.timezone : 'UTC',
          ).run()

          const created = await selectUserByEmail(db, email)
          if (!created) throw new Error('BETTER_AUTH_USER_CREATE_FAILED')
          return normalizeUser(created)
        }

        if (model === 'account') throw new Error('BETTER_AUTH_ACCOUNT_CREATE_DISABLED')

        if (model === 'users_sessions') {
          const userId = String(data._parent_id ?? '')
          if (!/^\d+$/.test(userId)) throw new Error('BETTER_AUTH_SESSION_USER_ID_INVALID')
          const id = String(data.id ?? data.token ?? crypto.randomUUID())
          const order = await db.prepare(
            'SELECT COALESCE(MAX(_order), -1) + 1 AS next_order FROM users_sessions WHERE _parent_id = ?',
          ).bind(Number(userId)).first<{ next_order?: number }>()
          await db.prepare(
            'INSERT INTO users_sessions (_order, _parent_id, id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
          ).bind(Number(order?.next_order ?? 0), Number(userId), id, iso(data.created_at), iso(data.expires_at)).run()
          const created = await selectSession(db, id)
          if (!created) throw new Error('BETTER_AUTH_SESSION_CREATE_FAILED')
          return created
        }

        throw new Error('BETTER_AUTH_MODEL_CREATE_UNSUPPORTED:' + model)
      },

      findOne: async ({ model, modelKey = model, where }) => {
        const clauses = where as WhereClause[]

        if (modelKey === 'account') {
          const providerId = whereValue(clauses, 'provider_id', 'providerId')
          if (providerId !== undefined && providerId !== 'credential') return null
          const userId = userIdFromAccountWhere(clauses)
          if (!userId) return null
          const user = await selectUserById(db, userId)
          return user ? buildCredentialAccount(user) : null
        }

        if (model === 'users') {
          const id = userIdFromWhere(clauses)
          const email = whereValue(clauses, 'email')
          let row: Row | null
          if (id) row = await selectUserById(db, id)
          else if (typeof email === 'string') row = await selectUserByEmail(db, email)
          else {
            const params: unknown[] = []
            row = await db.prepare(
              'SELECT * FROM users' + buildWhere('users', clauses, params) + ' LIMIT 1',
            ).bind(...params).first<Row>()
          }
          return row ? normalizeUser(row) : null
        }

        if (model === 'users_sessions') {
          const id = whereValue(clauses, 'id', 'token')
          if (id !== undefined && id !== null) {
            const row = await selectSession(db, String(id))
            return row && AUTHENTICATABLE_STATES.has(String(row.account_state)) ? row : null
          }
          const params: unknown[] = []
          const row = await db.prepare(
            'SELECT s.id, s._parent_id, s.created_at, s.expires_at, u.account_state, u.email ' +
              'FROM users_sessions s INNER JOIN users u ON u.id = s._parent_id' +
              buildWhere('users_sessions', clauses, params) + ' LIMIT 1',
          ).bind(...params).first<Row>()
          return row && AUTHENTICATABLE_STATES.has(String(row.account_state)) ? row : null
        }

        throw new Error('BETTER_AUTH_MODEL_FIND_ONE_UNSUPPORTED:' + modelKey)
      },

      findMany: async ({ model, modelKey = model, where, limit, offset, sortBy }) => {
        const clauses = (where ?? []) as WhereClause[]

        if (modelKey === 'account') {
          const userId = userIdFromAccountWhere(clauses)
          if (!userId) return []
          const user = await selectUserById(db, userId)
          const account = user ? buildCredentialAccount(user) : null
          return account ? [account] : []
        }

        if (model === 'users' || model === 'users_sessions') {
          const params: unknown[] = []
          let sql = model === 'users'
            ? 'SELECT * FROM users' + buildWhere('users', clauses, params)
            : 'SELECT s.id, s._parent_id, s.created_at, s.expires_at, s.created_at AS updatedAt, NULL AS ipAddress, NULL AS userAgent, u.account_state, u.email FROM users_sessions s INNER JOIN users u ON u.id = s._parent_id' +
              buildWhere('users_sessions', clauses, params)

          const fields = model === 'users' ? USER_FIELDS : SESSION_FIELDS
          if (sortBy?.field && fields[sortBy.field]) {
            sql += ' ORDER BY ' + fields[sortBy.field] + (sortBy.direction === 'desc' ? ' DESC' : ' ASC')
          }
          if (typeof limit === 'number') { sql += ' LIMIT ?'; params.push(limit) }
          if (typeof offset === 'number') { sql += ' OFFSET ?'; params.push(offset) }

          const result = await db.prepare(sql).bind(...params).all<Row>()
          return model === 'users'
            ? result.results.map(normalizeUser)
            : result.results.filter((row) => AUTHENTICATABLE_STATES.has(String(row.account_state)))
        }

        return []
      },

      count: async ({ model, where }) => {
        if (model === 'account') return 0
        if (model !== 'users' && model !== 'users_sessions') return 0
        const params: unknown[] = []
        const row = await db.prepare(
          'SELECT COUNT(*) AS count FROM ' + model + buildWhere(model, (where ?? []) as WhereClause[], params),
        ).bind(...params).first<{ count?: number }>()
        return Number(row?.count ?? 0)
      },

      update: async ({ model, modelKey = model, where, update }) => {
        const clauses = where as WhereClause[]
        if (!clauses.length) return null

        if (modelKey === 'account') {
          const userId = userIdFromAccountWhere(clauses)
          if (!userId) return null
          if (typeof update.password === 'string') {
            const packed = unpackPassword(update.password)
            if (!packed) throw new Error('BETTER_AUTH_PASSWORD_FORMAT_UNSUPPORTED')
            const result = await db.prepare(
              'UPDATE users SET salt = ?, hash = ?, updated_at = ? WHERE CAST(id AS TEXT) = ?',
            ).bind(packed.salt, packed.hash, new Date().toISOString(), userId).run()
            if (result.meta?.changes !== undefined && result.meta.changes !== 1) return null
          }
          const user = await selectUserById(db, userId)
          return user ? buildCredentialAccount(user) : null
        }

        if (model === 'users') {
          const setParts: string[] = []
          const params: unknown[] = []
          for (const [field, raw] of Object.entries(update)) {
            if (!['display_name', 'username', 'bio', 'avatar', 'locale', 'timezone'].includes(field)) continue
            setParts.push(field + ' = ?')
            params.push(raw)
          }
          if (!setParts.length) return null
          setParts.push('updated_at = ?')
          params.push(new Date().toISOString())
          const sql = 'UPDATE users SET ' + setParts.join(', ') + buildWhere('users', clauses, params)
          const result = await db.prepare(sql).bind(...params).run()
          if (result.meta?.changes === 0) return null
          const id = userIdFromWhere(clauses)
          return id ? normalizeUser((await selectUserById(db, id)) ?? {}) : null
        }

        if (model === 'users_sessions') {
          const expiresAt = update.expires_at
          if (!(expiresAt instanceof Date) && typeof expiresAt !== 'string') return null
          const params: unknown[] = [iso(expiresAt)]
          const sql = 'UPDATE users_sessions SET expires_at = ?' + buildWhere('users_sessions', clauses, params)
          const result = await db.prepare(sql).bind(...params).run()
          if (result.meta?.changes === 0) return null
          const id = whereValue(clauses, 'id', 'token')
          return id === undefined || id === null ? null : selectSession(db, String(id))
        }

        return null
      },

      delete: async ({ model, modelKey = model, where }) => {
        const clauses = where as WhereClause[]
        if (!clauses.length) return
        if (modelKey === 'account') throw new Error('BETTER_AUTH_CREDENTIAL_ACCOUNT_DELETE_DISABLED')
        const params: unknown[] = []
        const sql = 'DELETE FROM ' + model + buildWhere(model as 'users' | 'users_sessions', clauses, params)
        await db.prepare(sql).bind(...params).run()
      },

      deleteMany: async ({ model, where }) => {
        const clauses = (where ?? []) as WhereClause[]
        if (!clauses.length) throw new Error('BETTER_AUTH_DESTRUCTIVE_EMPTY_DELETE_DISABLED')
        if (model === 'account') return 0
        if (model !== 'users' && model !== 'users_sessions') return 0
        const params: unknown[] = []
        const sql = 'DELETE FROM ' + model + buildWhere(model, clauses, params)
        const result = await db.prepare(sql).bind(...params).run()
        return Number(result.meta?.changes ?? 0)
      },
    }),
  })

export const luckReadBetterAuthAdapter = (db: D1Database) => adapter(db)
