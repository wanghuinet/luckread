import type { AuditEvent } from './audit-event.js'

export interface AuditEventStore {
  findByEventId(eventId: string): Promise<AuditEvent | null>
  append(event: AuditEvent): Promise<void>
}

export class AuditEventStoreError extends Error {
  constructor(readonly code: 'AUDIT_EVENT_LOOKUP_FAILED' | 'AUDIT_EVENT_PERSISTENCE_FAILED') {
    super(code)
  }
}
