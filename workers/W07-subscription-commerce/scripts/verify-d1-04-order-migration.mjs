import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const ADMITTED_D1_04_UUID = '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736'
export const ORDER_MIGRATION_ID = '0001_order_commerce'
export const PAYMENT_MIGRATION_ID = '0002_payment_provider_events'
export const SAVED_METHOD_MIGRATION_ID = '0003_saved_payment_methods_mandates'
export const RENEWAL_MIGRATION_ID = '0004_subscription_renewal_cycles'
export const REVENUECAT_WEBHOOK_MIGRATION_ID = '0005_revenuecat_webhook_inbox'
export const REFUNDS_BILLING_MIGRATION_ID = '0006_refunds_billing_documents'
export const REQUIRED_MIGRATION_IDS = [ORDER_MIGRATION_ID, PAYMENT_MIGRATION_ID, SAVED_METHOD_MIGRATION_ID, RENEWAL_MIGRATION_ID, REVENUECAT_WEBHOOK_MIGRATION_ID, REFUNDS_BILLING_MIGRATION_ID]

export const REQUIRED_COLUMNS = {
  orders: [
    ['order_id', 'TEXT', 1, 1], ['customer_id', 'TEXT', 1, 0], ['status', 'TEXT', 1, 0],
    ['version', 'INTEGER', 1, 0], ['currency', 'TEXT', 1, 0], ['subtotal_minor', 'INTEGER', 1, 0],
    ['discount_minor', 'INTEGER', 1, 0], ['tax_minor', 'INTEGER', 1, 0], ['total_minor', 'INTEGER', 1, 0],
    ['created_at', 'TEXT', 1, 0], ['updated_at', 'TEXT', 1, 0], ['confirmed_at', 'TEXT', 0, 0],
    ['cancelled_at', 'TEXT', 0, 0], ['failure_code', 'TEXT', 0, 0],
  ],
  order_lines: [
    ['order_line_id', 'TEXT', 1, 1], ['order_id', 'TEXT', 1, 0], ['item_type', 'TEXT', 1, 0],
    ['item_ref', 'TEXT', 1, 0], ['item_version', 'TEXT', 1, 0], ['quantity', 'INTEGER', 1, 0],
    ['unit_amount_minor', 'INTEGER', 1, 0], ['line_subtotal_minor', 'INTEGER', 1, 0],
    ['line_discount_minor', 'INTEGER', 1, 0], ['line_tax_minor', 'INTEGER', 1, 0],
    ['line_total_minor', 'INTEGER', 1, 0], ['item_snapshot_json', 'TEXT', 1, 0], ['created_at', 'TEXT', 1, 0],
  ],
  order_create_idempotency: [
    ['id', 'TEXT', 1, 1], ['customer_id', 'TEXT', 1, 0], ['operation_key', 'TEXT', 1, 0],
    ['idempotency_key', 'TEXT', 1, 0], ['request_hash', 'TEXT', 1, 0], ['state', 'TEXT', 1, 0],
    ['response_status', 'INTEGER', 0, 0], ['response_json', 'TEXT', 0, 0],
    ['created_at', 'TEXT', 1, 0], ['expires_at', 'TEXT', 1, 0],
  ],
  payments: [
    ['payment_id', 'TEXT', 1, 1], ['order_id', 'TEXT', 1, 0], ['customer_id', 'TEXT', 1, 0],
    ['provider', 'TEXT', 1, 0], ['merchant_id', 'TEXT', 1, 0], ['amount_minor', 'INTEGER', 1, 0],
    ['currency', 'TEXT', 1, 0], ['status', 'TEXT', 1, 0], ['version', 'INTEGER', 1, 0],
    ['idempotency_key', 'TEXT', 1, 0], ['request_hash', 'TEXT', 1, 0],
    ['provider_updated_at', 'TEXT', 0, 0], ['failure_code', 'TEXT', 0, 0],
    ['created_at', 'TEXT', 1, 0], ['updated_at', 'TEXT', 1, 0],
  ],
  payment_provider_events: [
    ['event_row_id', 'TEXT', 1, 1], ['provider', 'TEXT', 1, 0], ['merchant_id', 'TEXT', 1, 0],
    ['event_id', 'TEXT', 1, 0], ['event_type', 'TEXT', 1, 0], ['payment_id', 'TEXT', 0, 0],
    ['payload_sha256', 'TEXT', 1, 0], ['state', 'TEXT', 1, 0], ['received_at', 'TEXT', 1, 0],
    ['processed_at', 'TEXT', 0, 0], ['outcome_code', 'TEXT', 0, 0],
  ],
  payment_provider_event_conflicts: [
    ['conflict_id', 'TEXT', 1, 1], ['provider', 'TEXT', 1, 0], ['merchant_id', 'TEXT', 1, 0],
    ['event_id', 'TEXT', 1, 0], ['existing_payload_sha256', 'TEXT', 1, 0],
    ['incoming_payload_sha256', 'TEXT', 1, 0], ['state', 'TEXT', 1, 0],
    ['occurrence_count', 'INTEGER', 1, 0], ['version', 'INTEGER', 1, 0],
    ['first_seen_at', 'TEXT', 1, 0], ['last_seen_at', 'TEXT', 1, 0],
    ['resolved_at', 'TEXT', 0, 0], ['resolution_code', 'TEXT', 0, 0],
  ],
  saved_payment_methods: [
    ['saved_payment_method_id', 'TEXT', 1, 1], ['provider', 'TEXT', 1, 0],
    ['merchant_id', 'TEXT', 1, 0], ['customer_id', 'TEXT', 1, 0],
    ['payment_method_id', 'TEXT', 1, 0], ['source_payment_id', 'TEXT', 1, 0],
    ['source_event_id', 'TEXT', 1, 0], ['created_at', 'TEXT', 1, 0],
  ],
  payment_mandates: [
    ['mandate_record_id', 'TEXT', 1, 1], ['provider', 'TEXT', 1, 0],
    ['merchant_id', 'TEXT', 1, 0], ['customer_id', 'TEXT', 1, 0],
    ['payment_method_id', 'TEXT', 1, 0], ['source_payment_id', 'TEXT', 1, 0],
    ['source_event_id', 'TEXT', 1, 0], ['consent_accepted_at', 'TEXT', 1, 0],
    ['consent_acceptance_type', 'TEXT', 1, 0], ['consent_scope', 'TEXT', 1, 0],
    ['consent_terms_version', 'TEXT', 1, 0], ['provider_mandate_id', 'TEXT', 0, 0],
    ['status', 'TEXT', 1, 0], ['version', 'INTEGER', 1, 0],
    ['provider_updated_at', 'TEXT', 0, 0], ['created_at', 'TEXT', 1, 0],
    ['updated_at', 'TEXT', 1, 0],
  ],
  subscription_renewal_cycles: [
    ['cycle_id', 'TEXT', 1, 1], ['provider', 'TEXT', 1, 0], ['merchant_id', 'TEXT', 1, 0],
    ['subscription_id', 'TEXT', 1, 0], ['subscriber_id', 'TEXT', 1, 0], ['plan_id', 'TEXT', 1, 0],
    ['plan_version', 'INTEGER', 1, 0], ['cycle_start', 'TEXT', 1, 0], ['cycle_end', 'TEXT', 1, 0],
    ['billing_interval', 'TEXT', 1, 0], ['currency', 'TEXT', 1, 0], ['offer_snapshot_json', 'TEXT', 1, 0],
    ['amount_minor', 'INTEGER', 0, 0], ['pricing_snapshot_json', 'TEXT', 0, 0],
    ['payment_method_id', 'TEXT', 0, 0], ['mandate_record_id', 'TEXT', 0, 0],
    ['order_id', 'TEXT', 0, 0], ['payment_id', 'TEXT', 0, 0], ['state', 'TEXT', 1, 0],
    ['attempt_number', 'INTEGER', 1, 0], ['provider_response_status', 'TEXT', 0, 0], ['outcome_code', 'TEXT', 0, 0],
    ['subscription_sync_state', 'TEXT', 1, 0], ['subscription_sync_updated_at', 'TEXT', 0, 0], ['subscription_sync_error_code', 'TEXT', 0, 0],
    ['lease_token', 'TEXT', 0, 0], ['lease_expires_at', 'TEXT', 0, 0], ['version', 'INTEGER', 1, 0],
    ['created_at', 'TEXT', 1, 0], ['updated_at', 'TEXT', 1, 0],
  ],
  subscription_renewal_scheduler_state: [
    ['state_id', 'TEXT', 1, 1], ['cursor_period_end', 'TEXT', 0, 0],
    ['cursor_subscription_id', 'TEXT', 0, 0], ['version', 'INTEGER', 1, 0], ['updated_at', 'TEXT', 1, 0],
  ],
  revenuecat_webhook_events: [
    ['event_row_id', 'TEXT', 1, 1], ['app_id', 'TEXT', 1, 0], ['event_id', 'TEXT', 1, 0],
    ['event_type', 'TEXT', 1, 0], ['event_timestamp_ms', 'INTEGER', 1, 0], ['api_version', 'TEXT', 1, 0],
    ['app_user_id', 'TEXT', 0, 0], ['product_id', 'TEXT', 0, 0], ['store', 'TEXT', 0, 0],
    ['environment', 'TEXT', 0, 0], ['transaction_id', 'TEXT', 0, 0], ['original_transaction_id', 'TEXT', 0, 0],
    ['event_data_json', 'TEXT', 1, 0], ['payload_sha256', 'TEXT', 1, 0], ['state', 'TEXT', 1, 0],
    ['received_at', 'TEXT', 1, 0], ['processed_at', 'TEXT', 0, 0], ['outcome_code', 'TEXT', 0, 0],
  ],
  revenuecat_webhook_event_conflicts: [
    ['conflict_id', 'TEXT', 1, 1], ['app_id', 'TEXT', 1, 0], ['event_id', 'TEXT', 1, 0],
    ['existing_payload_sha256', 'TEXT', 1, 0], ['incoming_payload_sha256', 'TEXT', 1, 0],
    ['occurrence_count', 'INTEGER', 1, 0], ['first_seen_at', 'TEXT', 1, 0], ['last_seen_at', 'TEXT', 1, 0],
  ],
  refunds: [
    ['refund_id', 'TEXT', 1, 1], ['provider', 'TEXT', 1, 0], ['merchant_id', 'TEXT', 1, 0],
    ['customer_id', 'TEXT', 1, 0], ['order_id', 'TEXT', 1, 0], ['payment_id', 'TEXT', 1, 0],
    ['amount_minor', 'INTEGER', 1, 0], ['captured_amount_minor', 'INTEGER', 1, 0], ['currency', 'TEXT', 1, 0],
    ['status', 'TEXT', 1, 0], ['reason', 'TEXT', 0, 0], ['idempotency_key', 'TEXT', 1, 0],
    ['request_hash', 'TEXT', 1, 0], ['provider_updated_at', 'TEXT', 0, 0], ['outcome_code', 'TEXT', 0, 0],
    ['version', 'INTEGER', 1, 0], ['created_at', 'TEXT', 1, 0], ['updated_at', 'TEXT', 1, 0],
  ],
  billing_documents: [
    ['document_id', 'TEXT', 1, 1], ['document_type', 'TEXT', 1, 0], ['document_number', 'TEXT', 1, 0],
    ['customer_id', 'TEXT', 1, 0], ['order_id', 'TEXT', 1, 0], ['payment_id', 'TEXT', 0, 0],
    ['amount_minor', 'INTEGER', 1, 0], ['currency', 'TEXT', 1, 0], ['snapshot_json', 'TEXT', 1, 0],
    ['issued_at', 'TEXT', 1, 0], ['created_at', 'TEXT', 1, 0],
  ],
}

export const REQUIRED_INDEXES = {
  orders: ['ix_orders_customer_created_order', 'ix_orders_status_created_order'],
  order_lines: ['ix_order_lines_order_id', 'ix_order_lines_item_ref_version'],
  order_create_idempotency: ['ix_order_create_idempotency_customer_created', 'ix_order_create_idempotency_expiration'],
  payments: ['ix_payments_customer_created_payment', 'ix_payments_order_created_payment', 'ix_payments_status_updated_payment', 'ux_payments_single_live_or_successful_per_order'],
  payment_provider_events: ['ix_payment_provider_events_state_received', 'ix_payment_provider_events_payment_received'],
  payment_provider_event_conflicts: [
    'ix_payment_provider_event_conflicts_state_last_seen',
    'ix_payment_provider_event_conflicts_identity',
  ],
  saved_payment_methods: ['ix_saved_payment_methods_customer_created'],
  payment_mandates: [
    'ux_payment_mandates_provider_mandate_id',
    'ix_payment_mandates_customer_status_created',
    'ix_payment_mandates_method_status',
  ],
  subscription_renewal_cycles: [
    'ux_subscription_renewal_cycles_subscription_cycle',
    'ux_subscription_renewal_cycles_payment',
    'ix_subscription_renewal_cycles_state_updated',
    'ix_subscription_renewal_cycles_subscriber_cycle',
  ],
  revenuecat_webhook_events: [
    'ix_revenuecat_webhook_events_state_received',
    'ix_revenuecat_webhook_events_user_received',
  ],
  revenuecat_webhook_event_conflicts: ['ix_revenuecat_webhook_conflicts_event'],
  refunds: ['ix_refunds_customer_created', 'ix_refunds_payment_created', 'ix_refunds_status_updated'],
  billing_documents: ['ix_billing_documents_customer_issued'],
}

export const REQUIRED_TRIGGERS = {
  orders: [
    'orders_commercial_snapshot_immutable', 'orders_version_must_advance',
    'orders_status_transition_guard', 'orders_retained',
    'orders_require_matching_completed_idempotency',
  ],
  order_lines: ['order_lines_require_order', 'order_lines_immutable_update', 'order_lines_retained'],
  order_create_idempotency: [
    'order_create_idempotency_identity_immutable', 'order_create_idempotency_terminal_immutable',
  ],
  payments: [
    'payments_require_payable_order', 'payments_snapshot_immutable', 'payments_version_must_advance',
    'payments_terminal_status_guard', 'payments_provider_timestamp_monotonic', 'payments_retained',
  ],
  payment_provider_events: [
    'payment_provider_events_identity_immutable',
    'payment_provider_events_terminal_immutable',
    'payment_provider_events_retained',
  ],
  payment_provider_event_conflicts: [
    'payment_provider_event_conflicts_identity_immutable',
    'payment_provider_event_conflicts_reference_first_receipt',
    'payment_provider_event_conflicts_version_guard',
    'payment_provider_event_conflicts_resolved_immutable',
    'payment_provider_event_conflicts_retained',
  ],
  saved_payment_methods: [
    'saved_payment_methods_require_succeeded_payment',
    'saved_payment_methods_customer_binding_guard',
    'saved_payment_methods_identity_immutable',
    'saved_payment_methods_retained',
  ],
  payment_mandates: [
    'payment_mandates_require_saved_method',
    'payment_mandates_start_pending',
    'payment_mandates_identity_immutable',
    'payment_mandates_version_guard',
    'payment_mandates_transition_guard',
    'payment_mandates_provider_id_immutable',
    'payment_mandates_provider_timestamp_monotonic',
    'payment_mandates_retained',
  ],
  subscription_renewal_cycles: [
    'subscription_renewal_cycles_initial_state_guard',
    'subscription_renewal_cycles_identity_immutable',
    'subscription_renewal_cycles_resolved_snapshot_immutable',
    'subscription_renewal_cycles_version_guard',
    'subscription_renewal_cycles_state_transition_guard',
    'subscription_renewal_cycles_sync_state_transition_guard',
    'subscription_renewal_cycles_order_binding_guard',
    'subscription_renewal_cycles_payment_binding_guard',
    'subscription_renewal_cycles_requires_active_mandate',
    'subscription_renewal_cycles_retained',
  ],
  subscription_renewal_scheduler_state: [
    'subscription_renewal_scheduler_state_identity_immutable',
    'subscription_renewal_scheduler_state_version_guard',
    'subscription_renewal_scheduler_state_retained',
  ],
  revenuecat_webhook_events: [
    'revenuecat_webhook_events_identity_immutable',
    'revenuecat_webhook_events_terminal_immutable',
    'revenuecat_webhook_events_retained',
  ],
  revenuecat_webhook_event_conflicts: [
    'revenuecat_webhook_conflicts_reference_first_receipt',
    'revenuecat_webhook_conflicts_identity_immutable',
    'revenuecat_webhook_conflicts_occurrence_guard',
    'revenuecat_webhook_conflicts_retained',
  ],
  refunds: [
    'refunds_require_captured_payment', 'refunds_identity_immutable', 'refunds_version_guard',
    'refunds_state_transition_guard', 'refunds_provider_timestamp_monotonic', 'refunds_retained',
  ],
  billing_documents: [
    'billing_documents_source_guard', 'billing_documents_identity_immutable', 'billing_documents_retained',
  ],
}

const targetNamesFor = (migrationId) => {
  const tables = migrationId === ORDER_MIGRATION_ID
    ? ['orders', 'order_lines', 'order_create_idempotency']
    : migrationId === PAYMENT_MIGRATION_ID
      ? ['payments', 'payment_provider_events', 'payment_provider_event_conflicts']
      : migrationId === SAVED_METHOD_MIGRATION_ID
        ? ['saved_payment_methods', 'payment_mandates']
        : migrationId === RENEWAL_MIGRATION_ID
          ? ['subscription_renewal_cycles', 'subscription_renewal_scheduler_state']
          : migrationId === REVENUECAT_WEBHOOK_MIGRATION_ID
            ? ['revenuecat_webhook_events', 'revenuecat_webhook_event_conflicts']
            : migrationId === REFUNDS_BILLING_MIGRATION_ID
              ? ['refunds', 'billing_documents']
              : []
  return new Set([
    ...tables,
    ...tables.flatMap((table) => REQUIRED_INDEXES[table] ?? []),
    ...tables.flatMap((table) => REQUIRED_TRIGGERS[table] ?? []),
  ])
}

function fail(message) {
  throw new Error('W07_D1_04_MIGRATION_GATE_FAILED: ' + message)
}

function collectObjects(value, output = [], seen = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, output, seen)
  } else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value)
    output.push(value)
    for (const item of Object.values(value)) collectObjects(item, output, seen)
  }
  return output
}

function schemaObjects(input) {
  const objects = collectObjects(input)
    .filter((row) =>
      ['table', 'view', 'index', 'trigger'].includes(row.type) &&
      typeof row.name === 'string' && typeof row.tbl_name === 'string' &&
      Object.prototype.hasOwnProperty.call(row, 'sql'))
    .map((row) => ({
      type: row.type,
      name: row.name,
      tableName: row.tbl_name,
      sql: typeof row.sql === 'string' ? row.sql : null,
    }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
  const unique = new Map()
  for (const object of objects) {
    const key = object.type + '\u0000' + object.name
    const previous = unique.get(key)
    if (previous && JSON.stringify(previous) !== JSON.stringify(object)) {
      fail('conflicting schema definitions for ' + object.type + ':' + object.name)
    }
    unique.set(key, object)
  }
  return [...unique.values()]
}

function migrationNames(input) {
  return [...new Set(collectObjects(input)
    .filter((row) => Object.keys(row).length === 1 &&
      typeof row.name === 'string' && row.name.trim() === row.name && row.name.length > 0)
    .map((row) => row.name.endsWith('.sql') ? row.name.slice(0, -4) : row.name))].sort()
}

function migrationTablePresent(objects) {
  return objects.some((object) => object.type === 'table' && object.name === 'd1_migrations')
}

function resolveMigrationState(objects, rawMigrationState) {
  const tablePresent = migrationTablePresent(objects)
  const wasSkipped = typeof rawMigrationState?.querySkipped === 'string'
  if (tablePresent && wasSkipped) fail('d1_migrations exists but the read-only history query was skipped')
  const names = migrationNames(rawMigrationState)
  if (!tablePresent && names.length > 0) fail('migration names were returned when d1_migrations is absent')
  if (!tablePresent && !wasSkipped) fail('migration history state is missing for a database without d1_migrations')
  return { tablePresent, names }
}

function writeReport(outputPath, report) {
  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), JSON.stringify(report, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    })
  }
  return report
}

/**
 * Determine exactly which reviewed migrations are pending. An already-applied
 * migration is not treated as a collision; a target object for a missing
 * migration is a partial/manual-intervention condition and fails closed.
 */
export function inspectD1_04OrderMigrationPreflight({ schemaSnapshot, migrationState }) {
  const objects = schemaObjects(schemaSnapshot)
  const state = resolveMigrationState(objects, migrationState)
  if (state.names.includes(PAYMENT_MIGRATION_ID) && !state.names.includes(ORDER_MIGRATION_ID)) {
    fail('payment migration is recorded without its required prior Order migration; manual schema reconciliation is required')
  }
  if (state.names.includes(SAVED_METHOD_MIGRATION_ID) &&
      (!state.names.includes(ORDER_MIGRATION_ID) || !state.names.includes(PAYMENT_MIGRATION_ID))) {
    fail('saved-method migration is recorded without its required Order and Payment migrations; manual schema reconciliation is required')
  }
  if (state.names.includes(RENEWAL_MIGRATION_ID) &&
      (!state.names.includes(ORDER_MIGRATION_ID) || !state.names.includes(PAYMENT_MIGRATION_ID) || !state.names.includes(SAVED_METHOD_MIGRATION_ID))) {
    fail('renewal migration is recorded without its required Order, Payment and mandate migrations; manual schema reconciliation is required')
  }
  if (state.names.includes(REVENUECAT_WEBHOOK_MIGRATION_ID) &&
      REQUIRED_MIGRATION_IDS.slice(0, 4).some((id) => !state.names.includes(id))) {
    fail('RevenueCat webhook migration is recorded without its required commerce migrations; manual schema reconciliation is required')
  }
  if (state.names.includes(REFUNDS_BILLING_MIGRATION_ID) &&
      REQUIRED_MIGRATION_IDS.slice(0, 5).some((id) => !state.names.includes(id))) {
    fail('refund/billing migration is recorded without its required prior commerce migrations; manual schema reconciliation is required')
  }
  const byName = new Set(objects.map((object) => object.name))

  for (const migrationId of state.names.filter((name) => REQUIRED_MIGRATION_IDS.includes(name))) {
    const missingObjects = [...targetNamesFor(migrationId)].filter((name) => !byName.has(name))
    if (missingObjects.length > 0) {
      fail('migration history records ' + migrationId + ' but target schema objects are missing: ' + missingObjects.join(', '))
    }
  }

  const pendingMigrationIds = REQUIRED_MIGRATION_IDS.filter((migrationId) => !state.names.includes(migrationId))
  const pendingObjectNames = new Set(pendingMigrationIds.flatMap((migrationId) => [...targetNamesFor(migrationId)]))
  const collisions = objects
    .filter((object) => pendingObjectNames.has(object.name))
    .map((object) => object.type + ':' + object.name)
  if (collisions.length > 0) {
    fail('target commerce objects already exist while migration history does not record pending migration(s) ' +
      pendingMigrationIds.join(', ') + ': ' + collisions.join(', '))
  }

  const allTargetObjectNames = [...REQUIRED_MIGRATION_IDS.flatMap((id) => [...targetNamesFor(id)])]
  return {
    result: pendingMigrationIds.length === 0 ? 'PREFLIGHT_PASS_ALREADY_APPLIED' : 'PREFLIGHT_PASS_PENDING_MIGRATIONS',
    action: pendingMigrationIds.length === 0 ? 'VERIFY_ONLY' : 'APPLY',
    binding: 'D1_04',
    databaseUuid: ADMITTED_D1_04_UUID,
    migrationId: pendingMigrationIds.at(-1) ?? REQUIRED_MIGRATION_IDS.at(-1),
    migrationIds: REQUIRED_MIGRATION_IDS,
    pendingMigrationIds,
    existingObjectNames: objects.map((object) => object.name),
    targetObjectNames: allTargetObjectNames,
    writesPerformed: false,
    deploymentPerformed: false,
  }
}

function tableColumns(input, tableName) {
  const columns = collectObjects(input)
    .filter((row) => Number.isInteger(row.cid) && typeof row.name === 'string' && typeof row.type === 'string')
    .map((row) => ({
      cid: row.cid,
      name: row.name,
      type: row.type.toUpperCase(),
      notnull: Number(row.notnull ?? 0),
      pk: Number(row.pk ?? 0),
    }))
    .sort((a, b) => a.cid - b.cid)
  if (columns.length === 0) fail('remote PRAGMA table_info returned no columns for ' + tableName)
  return columns
}

/**
 * Admit postflight only when all reviewed migration IDs, exact table columns,
 * all named indexes/triggers, and every pre-existing schema definition match.
 */
export function verifyD1_04OrderMigrationPostflight({
  preflightSchema,
  postflightSchema,
  migrationState,
  ordersTableInfo,
  orderLinesTableInfo,
  idempotencyTableInfo,
  paymentsTableInfo,
  paymentProviderEventsTableInfo,
  paymentProviderEventConflictsTableInfo,
  savedPaymentMethodsTableInfo,
  paymentMandatesTableInfo,
  renewalCyclesTableInfo,
  renewalSchedulerStateTableInfo,
  revenueCatWebhookEventsTableInfo,
  revenueCatWebhookConflictsTableInfo,
  refundsTableInfo,
  billingDocumentsTableInfo,
}) {
  const before = schemaObjects(preflightSchema)
  const after = schemaObjects(postflightSchema)
  const state = resolveMigrationState(after, migrationState)
  const missingMigrations = REQUIRED_MIGRATION_IDS.filter((migrationId) => !state.names.includes(migrationId))
  if (missingMigrations.length > 0) {
    fail('d1_migrations does not contain required migrations: ' + missingMigrations.join(', '))
  }

  const present = new Map(after.map((object) => [object.type + '\u0000' + object.name, object]))
  for (const tableName of Object.keys(REQUIRED_COLUMNS)) {
    const table = present.get('table\u0000' + tableName)
    if (!table || table.tableName !== tableName || typeof table.sql !== 'string' || table.sql.length === 0) {
      fail('missing or invalid target table definition: ' + tableName)
    }
  }

  const tableInfoByName = {
    orders: ordersTableInfo,
    order_lines: orderLinesTableInfo,
    order_create_idempotency: idempotencyTableInfo,
    payments: paymentsTableInfo,
    payment_provider_events: paymentProviderEventsTableInfo,
    payment_provider_event_conflicts: paymentProviderEventConflictsTableInfo,
    saved_payment_methods: savedPaymentMethodsTableInfo,
    payment_mandates: paymentMandatesTableInfo,
    subscription_renewal_cycles: renewalCyclesTableInfo,
    subscription_renewal_scheduler_state: renewalSchedulerStateTableInfo,
    revenuecat_webhook_events: revenueCatWebhookEventsTableInfo,
    revenuecat_webhook_event_conflicts: revenueCatWebhookConflictsTableInfo,
    refunds: refundsTableInfo,
    billing_documents: billingDocumentsTableInfo,
  }
  for (const [tableName, expectedColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const actual = tableColumns(tableInfoByName[tableName], tableName)
    const actualShape = actual.map((column) => [column.name, column.type, column.notnull])
    const expectedShape = expectedColumns.map((column) => [column[0], column[1], column[2]])
    if (JSON.stringify(actualShape) !== JSON.stringify(expectedShape)) {
      fail('remote column layout differs from the reviewed migration for ' + tableName +
        '; expected ' + JSON.stringify(expectedShape) + ', received ' + JSON.stringify(actualShape))
    }
    const actualPrimaryKeys = actual.filter((column) => column.pk === 1).map((column) => column.name)
    const expectedPrimaryKeys = expectedColumns.filter((column) => column[3] === 1).map((column) => column[0])
    if (JSON.stringify(actualPrimaryKeys) !== JSON.stringify(expectedPrimaryKeys)) {
      fail('remote primary-key layout differs from the reviewed migration for ' + tableName)
    }
  }

  const missingIndexes = Object.entries(REQUIRED_INDEXES).flatMap(([tableName, names]) =>
    names.filter((name) => {
      const object = present.get('index\u0000' + name)
      return !object || object.tableName !== tableName || typeof object.sql !== 'string' || object.sql.length === 0
    }))
  if (missingIndexes.length > 0) fail('required index definitions missing: ' + missingIndexes.join(', '))

  const missingTriggers = Object.entries(REQUIRED_TRIGGERS).flatMap(([tableName, names]) =>
    names.filter((name) => {
      const object = present.get('trigger\u0000' + name)
      return !object || object.tableName !== tableName || typeof object.sql !== 'string' || object.sql.length === 0
    }))
  if (missingTriggers.length > 0) fail('required trigger definitions missing: ' + missingTriggers.join(', '))

  const afterByKey = new Map(after.map((object) => [object.type + '\u0000' + object.name, object]))
  for (const oldObject of before) {
    const key = oldObject.type + '\u0000' + oldObject.name
    const newObject = afterByKey.get(key)
    if (!newObject || JSON.stringify(newObject) !== JSON.stringify(oldObject)) {
      fail('pre-existing schema object was removed or changed: ' + oldObject.type + ':' + oldObject.name)
    }
  }

  const beforeKeys = new Set(before.map((object) => object.type + '\u0000' + object.name))
  const allowedNewNames = new Set([...REQUIRED_MIGRATION_IDS.flatMap((id) => [...targetNamesFor(id)]), 'd1_migrations'])
  const unexpectedNew = after.filter((object) =>
    !beforeKeys.has(object.type + '\u0000' + object.name) && !allowedNewNames.has(object.name))
  if (unexpectedNew.length > 0) {
    fail('migration introduced unexpected schema objects: ' +
      unexpectedNew.map((object) => object.type + ':' + object.name).join(', '))
  }

  return {
    result: 'POSTFLIGHT_PASS',
    binding: 'D1_04',
    databaseUuid: ADMITTED_D1_04_UUID,
    appliedMigrations: REQUIRED_MIGRATION_IDS,
    verifiedTables: Object.keys(REQUIRED_COLUMNS),
    verifiedIndexes: Object.values(REQUIRED_INDEXES).flat(),
    verifiedTriggers: Object.values(REQUIRED_TRIGGERS).flat(),
    baselineSchemaPreserved: true,
    databaseRowsExported: false,
    deploymentPerformed: false,
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'))
}

function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === 'has-migration-table') {
    if (args.length !== 1) throw new Error('Usage: verify-d1-04-order-migration.mjs has-migration-table <schema-objects.json>')
    console.log(String(migrationTablePresent(schemaObjects(readJson(args[0])))))
    return
  }
  if (mode === 'preflight') {
    if (args.length !== 3) throw new Error('Usage: verify-d1-04-order-migration.mjs preflight <schema-objects.json> <migration-state.json> <output.json>')
    const report = inspectD1_04OrderMigrationPreflight({
      schemaSnapshot: readJson(args[0]),
      migrationState: readJson(args[1]),
    })
    writeReport(args[2], report)
    console.log(JSON.stringify(report, null, 2))
    return
  }
  if (mode === 'postflight') {
    if (args.length !== 18) throw new Error('Usage: verify-d1-04-order-migration.mjs postflight <preflight-schema.json> <postflight-schema.json> <migration-state.json> <orders-info.json> <order-lines-info.json> <idempotency-info.json> <payments-info.json> <provider-events-info.json> <event-conflicts-info.json> <saved-methods-info.json> <mandates-info.json> <renewal-cycles-info.json> <renewal-scheduler-state-info.json> <revenuecat-events-info.json> <revenuecat-conflicts-info.json> <refunds-info.json> <billing-documents-info.json> <output.json>')
    const report = verifyD1_04OrderMigrationPostflight({
      preflightSchema: readJson(args[0]),
      postflightSchema: readJson(args[1]),
      migrationState: readJson(args[2]),
      ordersTableInfo: readJson(args[3]),
      orderLinesTableInfo: readJson(args[4]),
      idempotencyTableInfo: readJson(args[5]),
      paymentsTableInfo: readJson(args[6]),
      paymentProviderEventsTableInfo: readJson(args[7]),
      paymentProviderEventConflictsTableInfo: readJson(args[8]),
      savedPaymentMethodsTableInfo: readJson(args[9]),
      paymentMandatesTableInfo: readJson(args[10]),
      renewalCyclesTableInfo: readJson(args[11]),
      renewalSchedulerStateTableInfo: readJson(args[12]),
      revenueCatWebhookEventsTableInfo: readJson(args[13]),
      revenueCatWebhookConflictsTableInfo: readJson(args[14]),
      refundsTableInfo: readJson(args[15]),
      billingDocumentsTableInfo: readJson(args[16]),
    })
    writeReport(args[17], report)
    console.log(JSON.stringify(report, null, 2))
    return
  }
  throw new Error('Expected mode: has-migration-table, preflight, or postflight')
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
