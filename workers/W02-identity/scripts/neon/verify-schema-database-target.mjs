export function resolveExpectedSchemaDatabase(env = process.env) {
  const expectedDatabase = env.W02_SCHEMA_EXPECTED_DATABASE ?? 'luckread_schema'
  if (!['luckread_schema', 'luckread'].includes(expectedDatabase)) {
    throw new Error(
      'W02_SCHEMA_EXPECTED_DATABASE must be luckread_schema (local rehearsal) or luckread (D1-01 Neon)',
    )
  }
  return expectedDatabase
}
