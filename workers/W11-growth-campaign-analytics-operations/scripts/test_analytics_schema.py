#!/usr/bin/env python3
"""Exercise the W11 D1-05 migration and the exact projection SQL used by the adapter."""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "migrations"
STORE = ROOT / "src" / "analytics-d1-store.ts"
READ_MODEL = ROOT / "src" / "analytics-read-model.ts"
RECONCILIATION = ROOT / "src" / "analytics-reconciliation.ts"
SQL_COLUMNS = (
    "event_id, dedupe_key, schema_version, event_name, source_worker, occurred_at, "
    "received_at, hour_start, actor_type, content_id, content_type, creator_id, "
    "duration_ms, position, metric_version, projection_status"
)


def extract_sql(source: str, constant: str) -> str:
    match = re.search(
        rf"const {re.escape(constant)} = String\.raw`(.*?)`",
        source,
        flags=re.DOTALL,
    )
    if not match:
        raise AssertionError(f"Unable to extract SQL constant {constant}")
    return match.group(1)


def extract_content_summary_sql(source: str) -> tuple[str, list[tuple[str, str]]]:
    match = re.search(
        r"const CONTENT_METRICS = \[(.*?)\] as const",
        source,
        flags=re.DOTALL,
    )
    if not match:
        raise AssertionError("Unable to extract CONTENT_METRICS from analytics-read-model.ts")
    metrics = re.findall(
        r"\['([A-Za-z][A-Za-z0-9]*)', '([a-z][a-z0-9_]*)'\]",
        match.group(1),
    )
    if len(metrics) != 27:
        raise AssertionError(f"Expected 27 content metrics, found {len(metrics)}")
    columns = ",\n  ".join(
        f"COALESCE(SUM({column}), 0) AS {key}" for key, column in metrics
    )
    query = (
        "SELECT\n  " + columns
        + "\nFROM analytics_content_hourly\n"
        + "WHERE content_id = ?\n"
        + "  AND content_type = ?\n"
        + "  AND hour_start >= ?\n"
        + "  AND hour_start < ?\n"
        + "  AND metric_version = ?"
    )
    return query, metrics


def build_content_comparison_sql(metrics: list[tuple[str, str]]) -> str:
    columns: list[str] = []
    for key, column in metrics:
        columns.append(
            f"COALESCE(SUM(CASE WHEN hour_start >= periods.current_from "
            f"AND hour_start < periods.current_to THEN {column} ELSE 0 END), 0) "
            f"AS current_{key}"
        )
        columns.append(
            f"COALESCE(SUM(CASE WHEN hour_start >= periods.previous_from "
            f"AND hour_start < periods.previous_to THEN {column} ELSE 0 END), 0) "
            f"AS previous_{key}"
        )
    return (
        "WITH periods AS (SELECT ? AS current_from, ? AS current_to, "
        "? AS previous_from, ? AS previous_to)\n"
        "SELECT\n  " + ",\n  ".join(columns)
        + "\nFROM analytics_content_hourly\nCROSS JOIN periods\n"
        + "WHERE content_id = ?\n"
        + "  AND content_type = ?\n"
        + "  AND metric_version = ?\n"
        + "  AND ((hour_start >= periods.current_from AND hour_start < periods.current_to)\n"
        + "       OR (hour_start >= periods.previous_from AND hour_start < periods.previous_to))"
    )


def build_top_content_sql(
    metrics: list[tuple[str, str]], content_id_count: int
) -> str:
    columns = ",\n  ".join(
        f"COALESCE(SUM({column}), 0) AS {key}" for key, column in metrics
    )
    placeholders = ", ".join("?" for _ in range(content_id_count))
    return (
        "SELECT\n  content_id AS contentId,\n  content_type AS contentType,\n  "
        + columns
        + f"\nFROM analytics_content_hourly\nWHERE content_id IN ({placeholders})\n"
        + "  AND hour_start >= ?\n"
        + "  AND hour_start < ?\n"
        + "  AND metric_version = ?\n"
        + "GROUP BY content_id, content_type\n"
        + "ORDER BY opens DESC, impressions DESC, content_id ASC, content_type ASC\n"
        + "LIMIT ?"
    )


def extract_template(source: str, constant: str) -> str:
    match = re.search(
        rf"const {re.escape(constant)} = `(.*?)`",
        source,
        flags=re.DOTALL,
    )
    if not match:
        raise AssertionError(f"Unable to extract {constant} from analytics-read-model.ts")
    return match.group(1)


def event(
    event_id: str,
    dedupe_key: str,
    name: str,
    worker: str = "W03",
    content_id: str | None = "article_01",
    content_type: str | None = "article",
    creator_id: str | None = None,
    duration_ms: int | None = None,
) -> tuple[object, ...]:
    occurred = "2026-10-14T00:12:34.000Z"
    hour = "2026-10-14T00:00:00.000Z"
    return (
        event_id, dedupe_key, "1.0", name, worker, occurred, occurred, hour,
        "user", content_id, content_type, creator_id, duration_ms, None, "1.0", "PENDING",
    )


def apply_batch(
    connection: sqlite3.Connection,
    rows: list[tuple[object, ...]],
    content_sql: str,
    creator_sql: str,
    mark_applied_sql: str,
) -> int:
    if not rows:
        return 0
    placeholders = "(" + ", ".join("?" for _ in rows[0]) + ")"
    insert_sql = (
        f"INSERT INTO analytics_event_dedupe ({SQL_COLUMNS}) VALUES "
        + placeholders
        + " ON CONFLICT DO NOTHING"
    )
    connection.execute("BEGIN")
    try:
        # Mirror the D1 adapter: one row per INSERT keeps each query at 16
        # bound parameters, below Cloudflare D1's per-query limit of 100.
        inserted = sum(
            connection.execute(insert_sql, row).rowcount for row in rows
        )
        connection.execute(content_sql)
        connection.execute(creator_sql)
        connection.execute(mark_applied_sql)
        connection.commit()
        return inserted
    except Exception:
        connection.rollback()
        raise


def select_from_insert(sql: str) -> str:
    match = re.search(r"\nSELECT\n.*", sql, flags=re.DOTALL)
    if not match:
        raise AssertionError("Unable to extract grouped SELECT from rebuild SQL")
    return match.group(0).lstrip()


def reconcile_hour(
    connection: sqlite3.Connection,
    hour_start: str,
    delete_content_sql: str,
    rebuild_content_sql: str,
    delete_creator_sql: str,
    rebuild_creator_sql: str,
    mark_applied_sql: str,
    replay_late_sql: str | None = None,
    replay_late: bool = False,
) -> None:
    connection.execute("BEGIN")
    try:
        if replay_late:
            if replay_late_sql is None:
                raise AssertionError("late-event replay SQL is required when replay is enabled")
            connection.execute(replay_late_sql, (hour_start,))
        connection.execute(delete_content_sql, (hour_start,))
        connection.execute(rebuild_content_sql, (hour_start,))
        connection.execute(delete_creator_sql, (hour_start,))
        connection.execute(rebuild_creator_sql, (hour_start,))
        connection.execute(mark_applied_sql, (hour_start,))
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def main() -> None:
    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not any(path.name == "0001_analytics_projection.sql" for path in migration_files):
        raise AssertionError("Base analytics projection migration is missing")
    if not any(path.name == "0002_analytics_projection_rebuild_state.sql" for path in migration_files):
        raise AssertionError("Projection rebuild state migration is missing")
    if not any(path.name == "0003_analytics_late_event_replay.sql" for path in migration_files):
        raise AssertionError("Durable late-event replay migration is missing")
    migrations_by_name = {path.name: path for path in migration_files}
    store_source = STORE.read_text(encoding="utf-8")
    read_model_source = READ_MODEL.read_text(encoding="utf-8")
    reconciliation_source = RECONCILIATION.read_text(encoding="utf-8")
    content_sql = extract_sql(store_source, "CONTENT_PROJECTION_SQL")
    creator_sql = extract_sql(store_source, "CREATOR_PROJECTION_SQL")
    mark_applied_sql = extract_sql(store_source, "MARK_APPLIED_SQL")
    content_read_sql, content_metrics = extract_content_summary_sql(read_model_source)
    creator_read_sql = extract_template(read_model_source, "CREATOR_FOLLOWER_SUMMARY_SQL")
    delete_content_rebuild_sql = extract_sql(reconciliation_source, "DELETE_CONTENT_HOUR_SQL")
    content_rebuild_sql = extract_sql(reconciliation_source, "REBUILD_CONTENT_HOUR_SQL")
    delete_creator_rebuild_sql = extract_sql(reconciliation_source, "DELETE_CREATOR_HOUR_SQL")
    creator_rebuild_sql = extract_sql(reconciliation_source, "REBUILD_CREATOR_HOUR_SQL")
    mark_hour_applied_sql = extract_sql(reconciliation_source, "MARK_HOUR_APPLIED_SQL")
    replay_late_sql = extract_sql(reconciliation_source, "REPLAY_LATE_FOR_HOUR_SQL")
    start_reconciliation_sql = extract_sql(reconciliation_source, "START_RECONCILIATION_SQL")
    finalize_reconciliation_sql = extract_sql(reconciliation_source, "FINALIZE_RECONCILIATION_SQL")
    fail_reconciliation_sql = extract_sql(reconciliation_source, "FAIL_RECONCILIATION_SQL")
    content_rebuild_select = select_from_insert(content_rebuild_sql)
    creator_rebuild_select = select_from_insert(creator_rebuild_sql)

    db = sqlite3.connect(":memory:")
    # Exercise migrations as an upgrade, not just a fresh concatenated schema.
    # Seed an existing row so migration 0003 must preserve data and indexes.
    db.executescript(
        migrations_by_name["0001_analytics_projection.sql"].read_text(encoding="utf-8")
    )
    legacy_row = list(event(
        "evt_migration_legacy_0001",
        "dedupe_migration_legacy_0001",
        "content_open",
        content_id="migration_legacy_article",
    ))
    legacy_row[-1] = "APPLIED"
    # Keep this preserved fixture outside the hourly bucket rebuilt below.
    legacy_row[5] = "2026-10-13T23:12:34.000Z"
    legacy_row[6] = "2026-10-13T23:12:34.000Z"
    legacy_row[7] = "2026-10-13T23:00:00.000Z"
    legacy_placeholders = "(" + ", ".join("?" for _ in legacy_row) + ")"
    db.execute(
        f"INSERT INTO analytics_event_dedupe ({SQL_COLUMNS}) VALUES {legacy_placeholders}",
        tuple(legacy_row),
    )
    db.commit()
    db.executescript(
        migrations_by_name["0002_analytics_projection_rebuild_state.sql"].read_text(encoding="utf-8")
    )
    db.executescript(
        migrations_by_name["0003_analytics_late_event_replay.sql"].read_text(encoding="utf-8")
    )

    preserved_legacy_row = db.execute(
        "SELECT event_id, dedupe_key, projection_status FROM analytics_event_dedupe "
        "WHERE event_id = 'evt_migration_legacy_0001'"
    ).fetchone()
    assert preserved_legacy_row == (
        "evt_migration_legacy_0001",
        "dedupe_migration_legacy_0001",
        "APPLIED",
    ), f"migration 0003 must preserve existing event rows: {preserved_legacy_row}"
    recreated_indexes = {
        row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'index' "
            "AND name LIKE 'analytics_event_dedupe_%_idx'"
        )
    }
    assert {
        "analytics_event_dedupe_ingested_at_idx",
        "analytics_event_dedupe_occurred_at_idx",
        "analytics_event_dedupe_hour_start_idx",
        "analytics_event_dedupe_pending_idx",
    }.issubset(recreated_indexes), (
        f"migration 0003 must recreate event ledger indexes: {recreated_indexes}"
    )


    columns = {
        row[1] for row in db.execute("PRAGMA table_info(analytics_event_dedupe)")
    }
    assert "event_id" in columns and "dedupe_key" in columns
    hour_plan = " ".join(
        row[3] for row in db.execute(
            "EXPLAIN QUERY PLAN SELECT event_id FROM analytics_event_dedupe WHERE hour_start = ?",
            ("2026-10-14T00:00:00.000Z",),
        )
    )
    assert "analytics_event_dedupe_hour_start_idx" in hour_plan, (
        f"hourly reconciliation ledger lookup should use the hour index: {hour_plan}"
    )
    assert not {"actor_id", "visitor_id", "session_id"}.intersection(columns), (
        "D1-05 event rows must not persist direct identity/session fields"
    )

    first_batch = [
        event("evt_schema_0001", "dedupe_schema_0001", "content_open"),
        event("evt_schema_0002", "dedupe_schema_0002", "content_open"),
        event("evt_schema_0003", "dedupe_schema_0003", "read_dwell", duration_ms=1250),
        event("evt_schema_0004", "dedupe_schema_0004", "like_created", "W05", "article_01", "article"),
        event("evt_schema_0005", "dedupe_schema_0005", "dwell", content_id="post_01", content_type="post", duration_ms=800),
        event("evt_schema_0006", "dedupe_schema_0006", "video_watch", content_id="video_01", content_type="video", duration_ms=2200),
        event("evt_schema_0007", "dedupe_schema_0007", "follow_created", "W05", None, None, "creator_01"),
        event("evt_schema_0008", "dedupe_schema_0008", "follow_removed", "W05", None, None, "creator_01"),
    ]
    inserted = apply_batch(db, first_batch, content_sql, creator_sql, mark_applied_sql)
    assert inserted == 8, f"expected 8 inserted events, got {inserted}"

    article = db.execute(
        "SELECT opens, read_duration_ms, read_duration_events, likes "
        "FROM analytics_content_hourly WHERE content_id = 'article_01'"
    ).fetchone()
    assert article == (2, 1250, 1, 1), f"unexpected article projection: {article}"

    post = db.execute(
        "SELECT dwell_duration_ms, dwell_events FROM analytics_content_hourly WHERE content_id = 'post_01'"
    ).fetchone()
    assert post == (800, 1), f"unexpected post projection: {post}"

    video = db.execute(
        "SELECT video_watch_ms, video_watch_events FROM analytics_content_hourly WHERE content_id = 'video_01'"
    ).fetchone()
    assert video == (2200, 1), f"unexpected video projection: {video}"

    creator = db.execute(
        "SELECT followers_gained, followers_lost FROM analytics_creator_hourly WHERE creator_id = 'creator_01'"
    ).fetchone()
    assert creator == (1, 1), f"unexpected creator projection: {creator}"

    # Execute the read-model SQL against the same migrated SQLite schema. These
    # strings are reconstructed from the TypeScript metric map and exact creator
    # query template so schema/column drift is caught without a mock DB.
    query_from = "2026-10-14T00:00:00.000Z"
    query_to = "2026-10-14T01:00:00.000Z"
    content_params = ("article_01", "article", query_from, query_to, "1.0")
    content_cursor = db.execute(content_read_sql, content_params)
    content_row = content_cursor.fetchone()
    content_summary = {
        description[0]: value
        for description, value in zip(content_cursor.description or (), content_row or ())
    }
    assert len(content_metrics) == 27
    assert content_summary["opens"] == 2 and content_summary["likes"] == 1, (
        f"unexpected content read model: {content_summary}"
    )

    # Execute the one-query current/previous comparison against the migrated DB.
    comparison_sql = build_content_comparison_sql(content_metrics)
    comparison_params = (
        "2026-10-14T00:00:00.000Z",
        "2026-10-14T01:00:00.000Z",
        "2026-10-13T00:00:00.000Z",
        "2026-10-14T00:00:00.000Z",
        "article_01",
        "article",
        "1.0",
    )
    comparison_cursor = db.execute(comparison_sql, comparison_params)
    comparison_row = {
        description[0]: value
        for description, value in zip(
            comparison_cursor.description or (), comparison_cursor.fetchone() or ()
        )
    }
    assert comparison_row["current_opens"] == 2, (
        f"current period comparison must include its opens: {comparison_row}"
    )
    assert comparison_row["previous_opens"] == 0, (
        f"previous period comparison must exclude current period buckets: {comparison_row}"
    )
    assert comparison_row["current_likes"] == 1 and comparison_row["previous_likes"] == 0, (
        f"comparison must separate social metrics by period: {comparison_row}"
    )
    comparison_plan = " ".join(
        row[3]
        for row in db.execute(
            "EXPLAIN QUERY PLAN " + comparison_sql,
            comparison_params,
        )
    )
    assert "analytics_content_hourly_content_id_time_idx" in comparison_plan, (
        f"period comparison should use the content/time index: {comparison_plan}"
    )
    plan = " ".join(
        row[3] for row in db.execute(
            "EXPLAIN QUERY PLAN " + content_read_sql, content_params
        )
    )
    assert "analytics_content_hourly_content_time_idx" in plan, (
        f"content summary query should use the composite content/time index: {plan}"
    )

    # Creator dashboards rank only the caller-authorized ID set; the content_id
    # leading index keeps this query from scanning every hourly content row.
    ranking_read_sql = build_top_content_sql(content_metrics, content_id_count=2)
    ranking_params = ("article_01", "post_01", query_from, query_to, "1.0", 10)
    ranking_rows = db.execute(ranking_read_sql, ranking_params).fetchall()
    assert ranking_rows and ranking_rows[0][0:2] == ("article_01", "article"), (
        f"unexpected top-content ordering: {ranking_rows}"
    )
    ranking_plan = " ".join(
        row[3]
        for row in db.execute(
            "EXPLAIN QUERY PLAN " + ranking_read_sql, ranking_params
        )
    )
    assert "analytics_content_hourly_content_id_time_idx" in ranking_plan, (
        f"content-set ranking query should use the content_id/time index: {ranking_plan}"
    )

    creator_cursor = db.execute(
        creator_read_sql, ("creator_01", query_from, query_to, "1.0")
    )
    creator_summary_row = creator_cursor.fetchone()
    creator_summary = {
        description[0]: value
        for description, value in zip(
            creator_cursor.description or (), creator_summary_row or ()
        )
    }
    assert creator_summary == {"followersGained": 1, "followersLost": 1}, (
        f"unexpected creator follower read model: {creator_summary}"
    )

    assert db.execute(
        "SELECT COUNT(*) FROM analytics_event_dedupe WHERE projection_status = 'PENDING'"
    ).fetchone()[0] == 0, "all committed events should be marked APPLIED"

    # Replaying an event ID or a dedupe key must not increment the projection.
    duplicates = [
        event("evt_schema_0001", "dedupe_replayed_different", "content_open"),
        event("evt_schema_newid", "dedupe_schema_0002", "content_open"),
    ]
    inserted = apply_batch(db, duplicates, content_sql, creator_sql, mark_applied_sql)
    assert inserted == 0, f"duplicate events unexpectedly inserted: {inserted}"
    assert db.execute(
        "SELECT opens FROM analytics_content_hourly WHERE content_id = 'article_01'"
    ).fetchone()[0] == 2, "replayed events must not double-count"

    # One bad owner/event mapping fails the whole transaction; it is not silently ignored.
    bad = [event("evt_schema_bad", "dedupe_schema_bad", "content_open", "W05")]
    try:
        apply_batch(db, bad, content_sql, creator_sql, mark_applied_sql)
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("schema must reject a W05 content_open event")
    assert db.execute(
        "SELECT COUNT(*) FROM analytics_event_dedupe WHERE event_id = 'evt_schema_bad'"
    ).fetchone()[0] == 0

    # A duration-bearing event must have a positive duration at the SQL boundary,
    # even if a future caller bypasses TypeScript event validation.
    missing_duration = [
        event(
            "evt_schema_missing_duration",
            "dedupe_schema_missing_duration",
            "read_dwell",
            duration_ms=None,
        )
    ]
    try:
        apply_batch(db, missing_duration, content_sql, creator_sql, mark_applied_sql)
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("schema must reject duration events with no duration")
    assert db.execute(
        "SELECT COUNT(*) FROM analytics_event_dedupe WHERE event_id = 'evt_schema_missing_duration'"
    ).fetchone()[0] == 0

    # Repair an intentionally corrupted rollup, remove a stale bucket, and
    # consume a valid PENDING ledger row. Re-running the same repair must be
    # idempotent, because projection rows are rebuilt (not incremented).
    hour = query_from
    db.execute(
        "UPDATE analytics_content_hourly SET opens = 999 WHERE content_id = 'article_01'"
    )
    db.execute(
        "UPDATE analytics_creator_hourly SET followers_gained = 88 WHERE creator_id = 'creator_01'"
    )
    db.execute(
        "INSERT INTO analytics_content_hourly (hour_start, content_id, content_type, metric_version) VALUES (?, ?, ?, ?)",
        (hour, "stale_content", "article", "1.0"),
    )
    pending = event(
        "evt_rebuild_pending_0001",
        "dedupe_rebuild_pending_0001",
        "content_open",
    )
    pending_placeholders = "(" + ", ".join("?" for _ in pending) + ")"
    db.execute(
        f"INSERT INTO analytics_event_dedupe ({SQL_COLUMNS}) VALUES {pending_placeholders}",
        pending,
    )
    # Late events are persisted under the canonical event/dedupe ledger with
    # projection_status=LATE. Ordinary hourly repairs must leave them out.
    late_row = list(event(
        "evt_rebuild_late_0001",
        "dedupe_rebuild_late_0001",
        "content_open",
    ))
    late_row[-1] = "LATE"
    db.execute(
        f"INSERT INTO analytics_event_dedupe ({SQL_COLUMNS}) VALUES {pending_placeholders}",
        tuple(late_row),
    )
    db.commit()

    content_rebuild_plan = " ".join(
        row[3] for row in db.execute(
            "EXPLAIN QUERY PLAN " + content_rebuild_select, (hour,)
        )
    )
    creator_rebuild_plan = " ".join(
        row[3] for row in db.execute(
            "EXPLAIN QUERY PLAN " + creator_rebuild_select, (hour,)
        )
    )
    assert "analytics_event_dedupe_hour_start_idx" in content_rebuild_plan, (
        f"content-hour repair should use event hour index: {content_rebuild_plan}"
    )
    assert "analytics_event_dedupe_hour_start_idx" in creator_rebuild_plan, (
        f"creator-hour repair should use event hour index: {creator_rebuild_plan}"
    )

    reconciliation_args = (
        db,
        hour,
        delete_content_rebuild_sql,
        content_rebuild_sql,
        delete_creator_rebuild_sql,
        creator_rebuild_sql,
        mark_hour_applied_sql,
    )
    reconcile_hour(*reconciliation_args)
    repaired_article = db.execute(
        "SELECT opens, read_duration_ms, read_duration_events, likes FROM analytics_content_hourly WHERE content_id = 'article_01'"
    ).fetchone()
    assert repaired_article == (3, 1250, 1, 1), (
        f"ordinary reconciliation must exclude the late event: {repaired_article}"
    )
    assert db.execute(
        "SELECT projection_status FROM analytics_event_dedupe WHERE event_id = 'evt_rebuild_late_0001'"
    ).fetchone()[0] == "LATE", "ordinary reconciliation must keep late events quarantined"
    assert db.execute(
        "SELECT COUNT(*) FROM analytics_content_hourly WHERE content_id = 'stale_content'"
    ).fetchone()[0] == 0, "reconciliation should remove stale projection buckets"
    repaired_creator = db.execute(
        "SELECT followers_gained, followers_lost FROM analytics_creator_hourly WHERE creator_id = 'creator_01'"
    ).fetchone()
    assert repaired_creator == (1, 1), f"creator projection not repaired: {repaired_creator}"
    assert db.execute(
        "SELECT COUNT(*) FROM analytics_event_dedupe WHERE projection_status = 'PENDING'"
    ).fetchone()[0] == 0, "reconciliation must mark bucket ledger rows APPLIED"

    # Explicit replay promotes only this UTC hour's quarantined rows in the same
    # transaction as replacement, then repeated replay remains idempotent.
    reconcile_hour(*reconciliation_args, replay_late_sql=replay_late_sql, replay_late=True)
    replayed_article = db.execute(
        "SELECT opens, read_duration_ms, read_duration_events, likes FROM analytics_content_hourly WHERE content_id = 'article_01'"
    ).fetchone()
    assert replayed_article == (4, 1250, 1, 1), (
        f"explicit late-event replay did not add exactly one open: {replayed_article}"
    )
    assert db.execute(
        "SELECT projection_status FROM analytics_event_dedupe WHERE event_id = 'evt_rebuild_late_0001'"
    ).fetchone()[0] == "APPLIED", "replayed late events should be marked APPLIED"

    reconcile_hour(*reconciliation_args, replay_late_sql=replay_late_sql, replay_late=True)
    assert db.execute(
        "SELECT opens FROM analytics_content_hourly WHERE content_id = 'article_01'"
    ).fetchone()[0] == 4, "re-running replay must not double-count"
    assert db.execute(
        "SELECT followers_gained FROM analytics_creator_hourly WHERE creator_id = 'creator_01'"
    ).fetchone()[0] == 1, "re-running reconciliation must preserve creator totals"

    # Keep only the latest repair state in a singleton row; no unbounded run history.
    db.execute(start_reconciliation_sql, ("run_success", hour))
    db.execute(finalize_reconciliation_sql, (hour, hour, "run_success"))
    success_state = db.execute(
        "SELECT status, hour_start, content_buckets_rebuilt, creator_buckets_rebuilt, error_code, completed_at "
        "FROM analytics_projection_rebuild_state WHERE singleton_id = 1"
    ).fetchone()
    assert success_state[0:5] == ("SUCCEEDED", hour, 3, 1, None), (
        f"unexpected successful reconciliation state: {success_state}"
    )
    assert success_state[5] is not None, "successful reconciliation needs a completion timestamp"
    db.commit()

    db.execute(start_reconciliation_sql, ("run_failure", hour))
    db.execute(fail_reconciliation_sql, ("REBUILD_FAILED", "run_failure"))
    failure_state = db.execute(
        "SELECT status, error_code, completed_at FROM analytics_projection_rebuild_state WHERE singleton_id = 1"
    ).fetchone()
    assert failure_state[0:2] == ("FAILED", "REBUILD_FAILED"), (
        f"unexpected failed reconciliation state: {failure_state}"
    )
    assert failure_state[2] is not None, "failed reconciliation needs a completion timestamp"
    db.commit()

    # Projections are written once per grouped dimension, not once per input event.
    grouping = content_sql.upper()
    assert "GROUP BY HOUR_START, CONTENT_TYPE, CONTENT_ID, METRIC_VERSION" in grouping
    assert "ON CONFLICT" in grouping
    assert "PROJECTION_STATUS = 'PENDING'" in grouping

    print("W11 D1-05 schema smoke test passed: migrations, grouped writes/reads, indexes, durable dedupe, late-event quarantine/replay, idempotent hourly reconciliation, bounded status, privacy, rollback")


if __name__ == "__main__":
    main()
