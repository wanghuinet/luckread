export interface W07WebhookPostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

export interface W07WebhookPostgresClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<W07WebhookPostgresQueryResult<Row>>;
  release(): void;
}

export interface W07WebhookPostgresPool {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<W07WebhookPostgresQueryResult<Row>>;
  connect(): Promise<W07WebhookPostgresClient>;
}
